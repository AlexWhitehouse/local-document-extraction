import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createLocalLiveUpdateHub } from "../src/localLiveUpdateHub";

export type LiveUpdateFanoutResult = {
  attemptedSends: number;
  events: number;
  microsecondsPerSend: number;
  rssGrowthBytes: number;
  sendsPerSecond: number;
  subscribers: number;
  wallTimeMs: number;
};

const repositoryRoot = resolve(import.meta.dir, "../..");

export function renderLiveUpdateFanoutBenchmark({
  bunRevision,
  bunVersion,
  platform,
  results,
}: {
  bunRevision: string;
  bunVersion: string;
  platform: string;
  results: LiveUpdateFanoutResult[];
}): string {
  return [
    "# Workspace live update fanout baseline",
    "",
    `- Runtime: Bun ${bunVersion} (${bunRevision})`,
    `- Platform: ${platform}`,
    "- Scope: current in-memory hub serialization, Workspace lookup, iteration, send-status accounting, and synthetic socket callback.",
    "- This benchmark does not measure Bun native topics, kernel/network delivery, TLS, browser parsing, or reconnect work.",
    "",
    "| Subscribers | Events | Attempted sends | Wall time | Per-send cost | Sends/second | RSS growth |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((result) => `| ${result.subscribers} | ${result.events} | ${result.attemptedSends} | ${result.wallTimeMs.toFixed(2)} ms | ${result.microsecondsPerSend.toFixed(3)} µs | ${Math.round(result.sendsPerSecond).toLocaleString("en-US")} | ${formatMiB(result.rssGrowthBytes)} |`),
    "",
    "These are focused local measurements, not a production capacity claim. Use them as the baseline for a separate native-topic prototype, not as evidence to migrate now.",
    "",
  ].join("\n");
}

async function run(): Promise<void> {
  const events = positiveInteger(process.env.LIVE_UPDATE_FANOUT_EVENTS, 500);
  const subscriberCounts = parseSubscriberCounts(
    process.env.LIVE_UPDATE_FANOUT_SUBSCRIBERS || "1,10,100,1000",
  );
  measureScenario(1, 10);
  const results = subscriberCounts.map((subscribers) => measureScenario(subscribers, events));
  const markdown = renderLiveUpdateFanoutBenchmark({
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    platform: `${process.platform} ${process.arch}`,
    results,
  });
  const evidenceDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "18-live-update-fanout.md"), markdown, "utf8");
  process.stdout.write(markdown);
}

function measureScenario(subscribers: number, events: number): LiveUpdateFanoutResult {
  Bun.gc(true);
  const rssBefore = process.memoryUsage().rss;
  const hub = createLocalLiveUpdateHub();
  const workspaceId = "workspace_fanout_benchmark";
  for (let index = 0; index < subscribers; index += 1) {
    hub.subscribe({
      workspaceId,
      socket: { send: (message) => message.length },
    });
  }
  const startedAt = performance.now();
  for (let index = 0; index < events; index += 1) {
    hub.broadcastJob(workspaceId, {
      job_id: `job_${index}`,
      status: index % 2 ? "processing" : "queued",
      template_id: "template_fanout",
      template_version: 1,
      error_code: null,
      error_message: null,
      created_at: "2026-08-20T12:00:00.000Z",
      updated_at: "2026-08-20T12:00:01.000Z",
      completed_at: null,
      current_attempt: 1,
      completed_attempt: 0,
      last_failed_attempt: 0,
    });
  }
  const wallTimeMs = performance.now() - startedAt;
  const attemptedSends = subscribers * events;
  const rssAfter = process.memoryUsage().rss;
  const diagnostics = hub.diagnostics();
  if (diagnostics.delivery.delivered !== attemptedSends) {
    throw new Error(`Fanout delivered ${diagnostics.delivery.delivered} of ${attemptedSends} sends`);
  }
  hub.closeAll();
  return {
    attemptedSends,
    events,
    microsecondsPerSend: attemptedSends ? (wallTimeMs * 1_000) / attemptedSends : 0,
    rssGrowthBytes: Math.max(0, rssAfter - rssBefore),
    sendsPerSecond: wallTimeMs > 0 ? attemptedSends / (wallTimeMs / 1_000) : 0,
    subscribers,
    wallTimeMs,
  };
}

function parseSubscriberCounts(value: string): number[] {
  const counts = value.split(",").map((part) => positiveInteger(part.trim(), 0));
  if (!counts.length || counts.some((count) => count < 1)) {
    throw new Error("LIVE_UPDATE_FANOUT_SUBSCRIBERS must contain positive comma-separated integers");
  }
  return counts;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

if (import.meta.main) await run();
