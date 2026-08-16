export type LocalQueuedExtractionJob = {
  job_id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  enqueued_at: string;
  attempt?: number;
  not_before?: string;
};

export type LocalExtractionQueueSnapshot = {
  active: number;
  deferred: number;
  durableDeferrals: number;
  maxBuffered: number;
  maxConcurrent: number;
  oldestEnqueuedAt: string | null;
  pending: number;
  readyWorkspaces: number;
};

export type LocalExtractionQueue = {
  schedule(job: LocalQueuedExtractionJob): Promise<void>;
  setMaxConcurrent(maxConcurrent: number): void;
  snapshot(): LocalExtractionQueueSnapshot;
  subscribe(handler: (job: LocalQueuedExtractionJob) => void | Promise<void>): () => void;
  waitForIdle(): Promise<void>;
};

type DeferredJob = {
  dueAt: number;
  job: LocalQueuedExtractionJob;
};

export function createLocalExtractionQueue({
  maxBuffered = 10_000,
  maxConcurrent = 8,
  now = Date.now,
  scheduleTimer = (handler, delayMs) => setTimeout(handler, delayMs),
  cancelTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  onHandlerError = (error) => console.error("Local extraction queue handler failed", error),
}: {
  maxBuffered?: number;
  maxConcurrent?: number;
  now?: () => number;
  scheduleTimer?: (handler: () => void, delayMs: number) => unknown;
  cancelTimer?: (timer: unknown) => void;
  onHandlerError?: (error: unknown, job: LocalQueuedExtractionJob) => void;
} = {}): LocalExtractionQueue {
  let currentMaxConcurrent = Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0
    ? maxConcurrent
    : 8;
  const normalizedMaxBuffered = Number.isSafeInteger(maxBuffered) && maxBuffered > 0
    ? maxBuffered
    : 10_000;
  const handlers = new Set<(job: LocalQueuedExtractionJob) => void | Promise<void>>();
  const workspaceQueues = new Map<string, LocalQueuedExtractionJob[]>();
  const readyWorkspaces: string[] = [];
  const readyWorkspaceSet = new Set<string>();
  const knownJobs = new Set<string>();
  const deferredJobs: DeferredJob[] = [];
  const idleWaiters: Array<() => void> = [];
  let active = 0;
  let durableDeferrals = 0;
  let deferredTimer: unknown = null;
  let deferredTimerDueAt: number | null = null;

  const settleIdle = () => {
    if (active !== 0 || pendingCount(workspaceQueues) !== 0 || deferredJobs.length !== 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const enqueueReady = (job: LocalQueuedExtractionJob) => {
    const queue = workspaceQueues.get(job.workspace_id) ?? [];
    queue.push(job);
    workspaceQueues.set(job.workspace_id, queue);
    if (!readyWorkspaceSet.has(job.workspace_id)) {
      readyWorkspaceSet.add(job.workspace_id);
      readyWorkspaces.push(job.workspace_id);
    }
  };

  const pump = () => {
    if (handlers.size === 0) return;
    while (active < currentMaxConcurrent && readyWorkspaces.length > 0) {
      const workspaceId = readyWorkspaces.shift()!;
      readyWorkspaceSet.delete(workspaceId);
      const queue = workspaceQueues.get(workspaceId);
      const job = queue?.shift();
      if (!job) {
        workspaceQueues.delete(workspaceId);
        continue;
      }
      if (queue!.length > 0) {
        readyWorkspaceSet.add(workspaceId);
        readyWorkspaces.push(workspaceId);
      } else {
        workspaceQueues.delete(workspaceId);
      }

      active += 1;
      void Promise.all(Array.from(handlers, (handler) => handler(job)))
        .catch((error) => onHandlerError(error, job))
        .finally(() => {
          active -= 1;
          knownJobs.delete(jobKey(job));
          pump();
          settleIdle();
        });
    }
  };

  const armDeferredTimer = () => {
    deferredJobs.sort((left, right) => left.dueAt - right.dueAt);
    const nextDueAt = deferredJobs[0]?.dueAt ?? null;
    if (nextDueAt === null) {
      if (deferredTimer !== null) cancelTimer(deferredTimer);
      deferredTimer = null;
      deferredTimerDueAt = null;
      settleIdle();
      return;
    }
    if (deferredTimer !== null && deferredTimerDueAt === nextDueAt) return;
    if (deferredTimer !== null) cancelTimer(deferredTimer);
    deferredTimerDueAt = nextDueAt;
    deferredTimer = scheduleTimer(() => {
      const firedDueAt = nextDueAt;
      deferredTimer = null;
      deferredTimerDueAt = null;
      const due = deferredJobs.filter((entry) => entry.dueAt <= firedDueAt);
      deferredJobs.splice(0, due.length);
      for (const entry of due) enqueueReady(entry.job);
      pump();
      armDeferredTimer();
    }, Math.max(0, nextDueAt - now()));
  };

  return {
    schedule: async (job) => {
      const key = jobKey(job);
      if (knownJobs.has(key)) return;
      if (pendingCount(workspaceQueues) + deferredJobs.length >= normalizedMaxBuffered) {
        durableDeferrals += 1;
        return;
      }
      knownJobs.add(key);
      const notBeforeMs = job.not_before ? Date.parse(job.not_before) : Number.NaN;
      if (Number.isFinite(notBeforeMs) && notBeforeMs > now()) {
        deferredJobs.push({ dueAt: notBeforeMs, job });
        armDeferredTimer();
        return;
      }
      enqueueReady(job);
      pump();
    },
    setMaxConcurrent: (value) => {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Extraction concurrency must be a non-negative integer");
      }
      currentMaxConcurrent = value;
      pump();
    },
    snapshot: () => ({
      active,
      deferred: deferredJobs.length,
      durableDeferrals,
      maxBuffered: normalizedMaxBuffered,
      maxConcurrent: currentMaxConcurrent,
      oldestEnqueuedAt: oldestEnqueuedAt(workspaceQueues, deferredJobs),
      pending: pendingCount(workspaceQueues),
      readyWorkspaces: readyWorkspaces.length,
    }),
    subscribe: (handler) => {
      handlers.add(handler);
      pump();
      return () => handlers.delete(handler);
    },
    waitForIdle: async () => {
      if (active === 0 && pendingCount(workspaceQueues) === 0 && deferredJobs.length === 0) return;
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

function jobKey(job: LocalQueuedExtractionJob): string {
  return `${job.workspace_id}\u0000${job.job_id}\u0000${job.attempt ?? 1}`;
}

function pendingCount(workspaceQueues: Map<string, LocalQueuedExtractionJob[]>): number {
  let total = 0;
  for (const queue of workspaceQueues.values()) total += queue.length;
  return total;
}

function oldestEnqueuedAt(
  workspaceQueues: Map<string, LocalQueuedExtractionJob[]>,
  deferredJobs: DeferredJob[],
): string | null {
  let oldest: string | null = null;
  for (const queue of workspaceQueues.values()) {
    for (const job of queue) {
      if (!oldest || job.enqueued_at < oldest) oldest = job.enqueued_at;
    }
  }
  for (const { job } of deferredJobs) {
    if (!oldest || job.enqueued_at < oldest) oldest = job.enqueued_at;
  }
  return oldest;
}
