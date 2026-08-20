import { readdir, stat, statfs } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";

import type { LocalExtractionQueueSnapshot } from "./localExtractionQueue";
import type { LocalMemoryPressureLevel } from "./localMemoryPressure";

type GatewayOutcome = "failed" | "success" | "throttled" | "timeout";

export type LocalResourceControllerSnapshot = {
  adaptive: boolean;
  completedJobs: number;
  completedJobsPerSecond: number;
  cpuRatio: number;
  disk: {
    availableBytes: number | null;
    reserveBytes: number;
    sourceBytes: number;
    sqliteBytes: number;
    walBytes: number;
  };
  eventLoopLagMs: number;
  gateway: Record<GatewayOutcome, number>;
  limits: {
    cpuRatio: number;
    memoryRatio: number;
  };
  memory: {
    externalBytes: number;
    heapUsedBytes: number;
    ratio: number;
    rssBytes: number;
    totalBytes: number;
  };
  memoryPressure: {
    activeLevel: LocalMemoryPressureLevel | null;
    evictedIdleStores: number;
    healthySamples: number;
    lastLevel: LocalMemoryPressureLevel | null;
    permitAfter: number | null;
    permitBefore: number | null;
    policyReason: string | null;
    recoveredAt: string | null;
    recoveryDurationMs: number | null;
    signaledAt: string | null;
  };
  permits: {
    current: number;
    initial: number;
    maximum: number;
    lastChangeReason: string | null;
  };
  sampledAt: string;
};

export type LocalResourceController = {
  canReserveSubmission(input: { requestBytes: number; reservedBytes: number }): Promise<boolean>;
  handleMemoryPressure(level: LocalMemoryPressureLevel): Promise<void>;
  recordCompletedJob(): void;
  recordGatewayOutcome(outcome: GatewayOutcome): void;
  sampleNow(): Promise<void>;
  snapshot(): LocalResourceControllerSnapshot;
  start(): void;
  stop(): void;
};

export function createLocalResourceController({
  adaptive = true,
  cpuLimitRatio = 0.85,
  diskReserveBytes = 1024 * 1024 * 1024,
  evictIdleStores = () => 0,
  getQueueSnapshot,
  initialPermits = 8,
  maximumPermits = Math.max(8, Math.min(32, cpus().length * 4)),
  memoryLimitRatio = 0.8,
  memoryPressureLargeSubmissionBytes = 4 * 1024 * 1024,
  now = Date.now,
  sampleIntervalMs = 5_000,
  setPermits,
  stateDirectory,
}: {
  adaptive?: boolean;
  cpuLimitRatio?: number;
  diskReserveBytes?: number;
  evictIdleStores?: () => number;
  getQueueSnapshot: () => LocalExtractionQueueSnapshot;
  initialPermits?: number;
  maximumPermits?: number;
  memoryLimitRatio?: number;
  memoryPressureLargeSubmissionBytes?: number;
  now?: () => number;
  sampleIntervalMs?: number;
  setPermits: (permits: number) => void;
  stateDirectory: string;
}): LocalResourceController {
  const cores = Math.max(1, cpus().length);
  const normalizedInitialPermits = positiveInteger(initialPermits, 8);
  const normalizedMaximumPermits = Math.max(
    normalizedInitialPermits,
    positiveInteger(maximumPermits, normalizedInitialPermits),
  );
  const normalizedSampleIntervalMs = positiveInteger(sampleIntervalMs, 5_000);
  const normalizedLargeSubmissionBytes = positiveInteger(
    memoryPressureLargeSubmissionBytes,
    4 * 1024 * 1024,
  );
  const totalMemoryBytes = totalmem();
  let currentPermits = normalizedInitialPermits;
  let timer: ReturnType<typeof setInterval> | null = null;
  let sampling: Promise<void> | null = null;
  let expectedSampleAt = now() + normalizedSampleIntervalMs;
  let previousCpu = process.cpuUsage();
  let previousCpuSampleAt = now();
  let healthySamples = 0;
  let memoryPressureRecoveryPermits = currentPermits;
  let memoryPressureSignaledAtMs: number | null = null;
  let storageSampledAt = 0;
  let completedJobs = 0;
  const completedAt: number[] = [];
  const gateway = { failed: 0, success: 0, throttled: 0, timeout: 0 };
  const gatewayWindow = { failed: 0, success: 0, throttled: 0, timeout: 0 };
  const memory = process.memoryUsage();
  const state: LocalResourceControllerSnapshot = {
    adaptive,
    completedJobs: 0,
    completedJobsPerSecond: 0,
    cpuRatio: 0,
    disk: {
      availableBytes: null,
      reserveBytes: Math.max(0, Math.trunc(diskReserveBytes)),
      sourceBytes: 0,
      sqliteBytes: 0,
      walBytes: 0,
    },
    eventLoopLagMs: 0,
    gateway,
    limits: { cpuRatio: cpuLimitRatio, memoryRatio: memoryLimitRatio },
    memory: {
      externalBytes: memory.external,
      heapUsedBytes: memory.heapUsed,
      ratio: memory.rss / totalMemoryBytes,
      rssBytes: memory.rss,
      totalBytes: totalMemoryBytes,
    },
    memoryPressure: {
      activeLevel: null,
      evictedIdleStores: 0,
      healthySamples: 0,
      lastLevel: null,
      permitAfter: null,
      permitBefore: null,
      policyReason: null,
      recoveredAt: null,
      recoveryDurationMs: null,
      signaledAt: null,
    },
    permits: {
      current: currentPermits,
      initial: normalizedInitialPermits,
      maximum: normalizedMaximumPermits,
      lastChangeReason: null,
    },
    sampledAt: new Date().toISOString(),
  };

  const updatePermits = (next: number, reason: string) => {
    const normalized = Math.max(0, Math.min(normalizedMaximumPermits, Math.trunc(next)));
    if (normalized === currentPermits) return;
    currentPermits = normalized;
    state.permits.current = normalized;
    state.permits.lastChangeReason = reason;
    setPermits(normalized);
  };

  const sample = async () => {
    const sampledAt = now();
    const elapsedMicros = Math.max(1, (sampledAt - previousCpuSampleAt) * 1_000);
    const cpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    previousCpuSampleAt = sampledAt;
    state.cpuRatio = Math.min(1, (cpu.user + cpu.system) / elapsedMicros / cores);
    state.eventLoopLagMs = Math.max(0, sampledAt - expectedSampleAt);
    expectedSampleAt = sampledAt + normalizedSampleIntervalMs;

    const usage = process.memoryUsage();
    state.memory = {
      externalBytes: usage.external,
      heapUsedBytes: usage.heapUsed,
      ratio: usage.rss / totalMemoryBytes,
      rssBytes: usage.rss,
      totalBytes: totalMemoryBytes,
    };
    while (completedAt[0] !== undefined && completedAt[0] < sampledAt - 60_000) completedAt.shift();
    state.completedJobs = completedJobs;
    state.completedJobsPerSecond = completedAt.length / 60;
    state.sampledAt = new Date(sampledAt).toISOString();

    if (sampledAt - storageSampledAt >= 60_000) {
      await refreshStorageSample();
    }

    const hardPressure = state.memory.ratio >= memoryLimitRatio || state.eventLoopLagMs >= 250;
    const resumePressure = state.memory.ratio < memoryLimitRatio * 0.9 && state.eventLoopLagMs < 100;
    if (state.memoryPressure.activeLevel) {
      if (hardPressure || !resumePressure) {
        state.memoryPressure.healthySamples = 0;
        if (hardPressure) {
          updatePermits(0, state.memory.ratio >= memoryLimitRatio ? "memory_limit" : "event_loop_limit");
        }
      } else {
        state.memoryPressure.healthySamples += 1;
        if (state.memoryPressure.healthySamples >= 3) {
          state.memoryPressure.activeLevel = null;
          state.memoryPressure.recoveredAt = new Date(sampledAt).toISOString();
          state.memoryPressure.recoveryDurationMs = memoryPressureSignaledAtMs === null
            ? null
            : Math.max(0, sampledAt - memoryPressureSignaledAtMs);
          updatePermits(memoryPressureRecoveryPermits, "os_memory_pressure_recovered");
        }
      }
    } else if (hardPressure) {
      healthySamples = 0;
      updatePermits(0, state.memory.ratio >= memoryLimitRatio ? "memory_limit" : "event_loop_limit");
    } else if (currentPermits === 0 && resumePressure) {
      updatePermits(normalizedInitialPermits, "resource_pressure_recovered");
    } else if (adaptive) {
      if (gatewayWindow.throttled > 0) {
        healthySamples = 0;
        updatePermits(Math.max(1, Math.floor(currentPermits * 0.7)), "gateway_throttled");
      } else if (gatewayWindow.timeout > 0) {
        healthySamples = 0;
        updatePermits(Math.max(1, currentPermits - 1), "gateway_timeout");
      } else if (state.cpuRatio >= cpuLimitRatio) {
        healthySamples = 0;
        updatePermits(Math.max(1, Math.floor(currentPermits * 0.8)), "cpu_limit");
      } else {
        const queue = getQueueSnapshot();
        const saturated = queue.pending + queue.deferred > 0 && queue.active >= currentPermits;
        const hasHeadroom = state.cpuRatio < cpuLimitRatio * 0.88
          && state.memory.ratio < memoryLimitRatio * 0.9
          && state.eventLoopLagMs < 50;
        healthySamples = saturated && hasHeadroom ? healthySamples + 1 : 0;
        if (healthySamples >= 3 && currentPermits < normalizedMaximumPermits) {
          healthySamples = 0;
          updatePermits(currentPermits + 1, "sustained_resource_headroom");
        }
      }
    }

    gatewayWindow.failed = 0;
    gatewayWindow.success = 0;
    gatewayWindow.throttled = 0;
    gatewayWindow.timeout = 0;
  };

  const sampleNow = () => {
    if (sampling) return sampling;
    sampling = sample().finally(() => {
      sampling = null;
    });
    return sampling;
  };

  const refreshStorageSample = async () => {
    storageSampledAt = now();
    const fileSystem = await statfs(stateDirectory).catch(() => null);
    if (fileSystem) {
      state.disk.availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
    }
    const [sourceBytes, databaseBytes] = await Promise.all([
      directoryBytes(join(stateDirectory, "source-files")),
      databaseStorageBytes(join(stateDirectory, "data", "workspaces")),
    ]);
    state.disk.sourceBytes = sourceBytes;
    state.disk.sqliteBytes = databaseBytes.sqliteBytes;
    state.disk.walBytes = databaseBytes.walBytes;
  };

  return {
    canReserveSubmission: async ({ requestBytes, reservedBytes }) => {
      const pressureLevel = state.memoryPressure.activeLevel;
      if (pressureLevel === "critical") return false;
      if (pressureLevel === "warning" && requestBytes >= normalizedLargeSubmissionBytes) return false;
      if (now() - storageSampledAt >= 2_000) await refreshStorageSample();
      const usage = process.memoryUsage();
      const withinMemory = usage.rss + Math.max(0, requestBytes) < totalMemoryBytes * memoryLimitRatio;
      const availableBytes = state.disk.availableBytes;
      const withinDisk = availableBytes === null
        || availableBytes - Math.max(0, reservedBytes) - Math.max(0, requestBytes) >= state.disk.reserveBytes;
      return withinMemory && withinDisk;
    },
    recordCompletedJob: () => {
      completedJobs += 1;
      completedAt.push(now());
    },
    recordGatewayOutcome: (outcome) => {
      gateway[outcome] += 1;
      gatewayWindow[outcome] += 1;
    },
    handleMemoryPressure: async (level) => {
      const signaledAt = now();
      if (!state.memoryPressure.activeLevel) {
        memoryPressureRecoveryPermits = currentPermits;
      }
      const effectiveLevel = state.memoryPressure.activeLevel === "critical" || level === "critical"
        ? "critical"
        : "warning";
      const permitBefore = currentPermits;
      const policyReason = `os_memory_pressure_${effectiveLevel}`;
      const evicted = effectiveLevel === "critical" ? evictIdleStores() : 0;
      memoryPressureSignaledAtMs = signaledAt;
      state.memoryPressure = {
        activeLevel: effectiveLevel,
        evictedIdleStores: evicted,
        healthySamples: 0,
        lastLevel: effectiveLevel,
        permitAfter: permitBefore,
        permitBefore,
        policyReason,
        recoveredAt: null,
        recoveryDurationMs: null,
        signaledAt: new Date(signaledAt).toISOString(),
      };
      updatePermits(
        effectiveLevel === "critical" ? 0 : Math.max(1, Math.floor(currentPermits / 2)),
        policyReason,
      );
      state.memoryPressure.permitAfter = currentPermits;
      await sampleNow();
    },
    sampleNow,
    snapshot: () => structuredClone(state),
    start: () => {
      if (timer) return;
      expectedSampleAt = now() + normalizedSampleIntervalMs;
      void sampleNow();
      timer = setInterval(() => void sampleNow(), normalizedSampleIntervalMs);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

async function directoryBytes(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let bytes = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      bytes += await directoryBytes(path);
    } else if (entry.isFile()) {
      bytes += (await stat(path).catch(() => null))?.size ?? 0;
    }
  }
  return bytes;
}

async function databaseStorageBytes(root: string): Promise<{ sqliteBytes: number; walBytes: number }> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let sqliteBytes = 0;
  let walBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const size = (await stat(join(root, entry.name)).catch(() => null))?.size ?? 0;
    if (entry.name.endsWith("-wal") || entry.name.endsWith("-shm")) walBytes += size;
    else if (entry.name.endsWith(".sqlite") || entry.name.endsWith("-journal")) sqliteBytes += size;
  }
  return { sqliteBytes, walBytes };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
