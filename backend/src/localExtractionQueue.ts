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
  accepting: boolean;
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
  close(): Promise<void>;
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
  getWorkspaceMaxConcurrent = () => Number.MAX_SAFE_INTEGER,
  onWorkspaceIdle,
  onCapacityAvailable,
}: {
  maxBuffered?: number;
  maxConcurrent?: number;
  now?: () => number;
  scheduleTimer?: (handler: () => void, delayMs: number) => unknown;
  cancelTimer?: (timer: unknown) => void;
  onHandlerError?: (error: unknown, job: LocalQueuedExtractionJob) => void;
  getWorkspaceMaxConcurrent?: (workspaceId: string) => number;
  onWorkspaceIdle?: (workspaceId: string) => void | Promise<void>;
  onCapacityAvailable?: () => void | Promise<void>;
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
  const closeWaiters: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];
  let accepting = true;
  let active = 0;
  let pending = 0;
  let overflowed = false;
  const activeByWorkspace = new Map<string, number>();
  let durableDeferrals = 0;
  let deferredTimer: unknown = null;
  let deferredTimerDueAt: number | null = null;

  const settleIdle = () => {
    if (active !== 0 || pending !== 0 || deferredJobs.length !== 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const settleClose = () => {
    if (accepting || active !== 0) return;
    for (const resolve of closeWaiters.splice(0)) resolve();
  };

  const enqueueReady = (job: LocalQueuedExtractionJob) => {
    const queue = workspaceQueues.get(job.workspace_id) ?? [];
    queue.push(job);
    pending += 1;
    workspaceQueues.set(job.workspace_id, queue);
    if (!readyWorkspaceSet.has(job.workspace_id)) {
      readyWorkspaceSet.add(job.workspace_id);
      readyWorkspaces.push(job.workspace_id);
    }
  };

  const pump = () => {
    if (handlers.size === 0) return;
    let skipped = 0;
    while (active < currentMaxConcurrent && readyWorkspaces.length > skipped) {
      const workspaceId = readyWorkspaces.shift()!;
      const workspaceActive = activeByWorkspace.get(workspaceId) ?? 0;
      if (workspaceActive >= getWorkspaceMaxConcurrent(workspaceId)) {
        readyWorkspaces.push(workspaceId);
        skipped += 1;
        continue;
      }
      skipped = 0;
      readyWorkspaceSet.delete(workspaceId);
      const queue = workspaceQueues.get(workspaceId);
      const job = queue?.shift();
      if (!job) {
        workspaceQueues.delete(workspaceId);
        continue;
      }
      pending -= 1;
      if (queue!.length > 0) {
        readyWorkspaceSet.add(workspaceId);
        readyWorkspaces.push(workspaceId);
      } else {
        workspaceQueues.delete(workspaceId);
      }

      active += 1;
      activeByWorkspace.set(workspaceId, workspaceActive + 1);
      void Promise.all(Array.from(handlers, (handler) => handler(job)))
        .catch((error) => onHandlerError(error, job))
        .finally(() => {
          active -= 1;
          const remaining = (activeByWorkspace.get(workspaceId) ?? 1) - 1;
          if (remaining) activeByWorkspace.set(workspaceId, remaining);
          else activeByWorkspace.delete(workspaceId);
          knownJobs.delete(jobKey(job));
          pump();
          settleIdle();
          settleClose();
          if (accepting && !activeByWorkspace.has(workspaceId) && !workspaceQueues.has(workspaceId)) {
            void Promise.resolve().then(() => onWorkspaceIdle?.(workspaceId)).catch((error) => onHandlerError(error, job));
          }
          if (accepting && overflowed && pending + deferredJobs.length < Math.max(1, normalizedMaxBuffered / 2)) {
            overflowed = false;
            void Promise.resolve().then(() => onCapacityAvailable?.()).catch((error) => onHandlerError(error, job));
          }
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
    close: async () => {
      if (accepting) {
        accepting = false;
        currentMaxConcurrent = 0;
        if (deferredTimer !== null) cancelTimer(deferredTimer);
        deferredTimer = null;
        deferredTimerDueAt = null;
        deferredJobs.splice(0);
        workspaceQueues.clear();
        pending = 0;
        readyWorkspaces.splice(0);
        readyWorkspaceSet.clear();
        knownJobs.clear();
        settleIdle();
      }
      if (active === 0) return;
      await new Promise<void>((resolve) => closeWaiters.push(resolve));
    },
    schedule: async (job) => {
      if (!accepting) {
        durableDeferrals += 1;
        return;
      }
      const key = jobKey(job);
      if (knownJobs.has(key)) return;
      if (pending + deferredJobs.length >= normalizedMaxBuffered) {
        durableDeferrals += 1;
        overflowed = true;
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
      currentMaxConcurrent = accepting ? value : 0;
      pump();
    },
    snapshot: () => ({
      accepting,
      active,
      deferred: deferredJobs.length,
      durableDeferrals,
      maxBuffered: normalizedMaxBuffered,
      maxConcurrent: currentMaxConcurrent,
      oldestEnqueuedAt: oldestEnqueuedAt(workspaceQueues, deferredJobs),
      pending,
      readyWorkspaces: readyWorkspaces.length,
    }),
    subscribe: (handler) => {
      if (!accepting) return () => {};
      handlers.add(handler);
      pump();
      return () => handlers.delete(handler);
    },
    waitForIdle: async () => {
      if (active === 0 && pending === 0 && deferredJobs.length === 0) return;
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

function jobKey(job: LocalQueuedExtractionJob): string {
  return `${job.workspace_id}\u0000${job.job_id}\u0000${job.attempt ?? 1}`;
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
