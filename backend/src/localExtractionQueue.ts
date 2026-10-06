export type LocalQueuedExtractionJob = {
  job_id: string;
  workspace_id: string;
  template_id: string | null;
  template_version: number | null;
  kind?: "packet";
  enqueued_at: string;
  attempt?: number;
  not_before?: string;
};

type LocalTransientExtractionTask = {
  kind: "evaluation";
  job_id: string;
  workspace_id: string;
  enqueued_at: string;
  attempt?: number;
  not_before?: string;
  owner: string;
  run(): Promise<void>;
  discard(): void;
};

type ScheduledWork = LocalQueuedExtractionJob | LocalTransientExtractionTask;

type TransientAdmission = "accepted" | "duplicate" | "full" | "closed";

const isTransient = (job: ScheduledWork): job is LocalTransientExtractionTask =>
  "kind" in job && job.kind === "evaluation";

export type LocalProcessingCapacity = {
  suspend(): void;
  resume(): Promise<void>;
};

export type LocalExtractionQueueSnapshot = {
  waiting?: number;
  inFlight?: number;
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
  scheduleTransient(task: LocalTransientExtractionTask): TransientAdmission;
  discardTransient(owner: string): void;
  setMaxConcurrent(maxConcurrent: number): void;
  snapshot(): LocalExtractionQueueSnapshot;
  subscribe(handler: (job: LocalQueuedExtractionJob, capacity: LocalProcessingCapacity) => void | Promise<void>): () => void;
  waitForIdle(): Promise<void>;
};

type DeferredJob = {
  dueAt: number;
  job: ScheduledWork;
};

export function createLocalExtractionQueue({
  maxBuffered = 10_000,
  maxConcurrent = 16,
  maxWaiting = 1_500,
  now = Date.now,
  scheduleTimer = (handler, delayMs) => setTimeout(handler, delayMs),
  cancelTimer = (timer) => clearTimeout(timer),
  onHandlerError = (error) => console.error("Local extraction queue handler failed", error),
  getWorkspaceMaxConcurrent = () => Number.MAX_SAFE_INTEGER,
  onWorkspaceIdle,
  onCapacityAvailable,
}: {
  maxBuffered?: number;
  maxConcurrent?: number;
  maxWaiting?: number;
  now?: () => number;
  scheduleTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout> | number | undefined;
  cancelTimer?: (timer: ReturnType<typeof setTimeout> | number | undefined) => void;
  onHandlerError?: (cause: unknown, job: LocalQueuedExtractionJob) => void;
  getWorkspaceMaxConcurrent?: (workspaceId: string) => number;
  onWorkspaceIdle?: (workspaceId: string) => void | Promise<void>;
  onCapacityAvailable?: () => void | Promise<void>;
} = {}): LocalExtractionQueue {
  let currentMaxConcurrent = Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 16;

  const normalizedMaxBuffered = Number.isSafeInteger(maxBuffered) && maxBuffered > 0 ? maxBuffered : 10_000;

  const handlers = new Set<(job: LocalQueuedExtractionJob, capacity: LocalProcessingCapacity) => void | Promise<void>>();
  const workspaceQueues = new Map<string, ScheduledWork[]>();
  const readyWorkspaces: string[] = [];
  const readyWorkspaceSet = new Set<string>();
  const knownJobs = new Set<string>();
  const deferredJobs: DeferredJob[] = [];
  const closeWaiters: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];
  let accepting = true;
  let active = 0;
  let waiting = 0;
  let inFlight = 0;
  let drainConcurrency = currentMaxConcurrent;
  const resumptions: Array<() => void> = [];
  const waitingLimit = Number.isSafeInteger(maxWaiting) && maxWaiting > 0 ? maxWaiting : 1_500;
  let pending = 0;
  let overflowed = false;
  const activeByWorkspace = new Map<string, number>();
  const lastWasPacket = new Map<string, boolean>();
  let durableDeferrals = 0;
  let deferredTimer: ReturnType<typeof setTimeout> | number | undefined | null = null;
  let deferredTimerDueAt: number | null = null;

  const settleIdle = () => {
    if (inFlight !== 0 || pending !== 0 || deferredJobs.length !== 0) return;

    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const settleClose = () => {
    if (accepting || inFlight !== 0) return;

    for (const resolve of closeWaiters.splice(0)) resolve();
  };

  const enqueueReady = (job: ScheduledWork) => {
    const queue = workspaceQueues.get(job.workspace_id) ?? [];
    queue.push(job);
    pending += 1;
    workspaceQueues.set(job.workspace_id, queue);

    if (!readyWorkspaceSet.has(job.workspace_id)) {
      readyWorkspaceSet.add(job.workspace_id);
      readyWorkspaces.push(job.workspace_id);
    }
  };

  const admit = (job: ScheduledWork) => {
    knownJobs.add(jobKey(job));
    const dueAt = job.not_before ? Date.parse(job.not_before) : Number.NaN;

    if (Number.isFinite(dueAt) && dueAt > now()) {
      deferredJobs.push({ dueAt, job });
      armDeferredTimer();
    } else {
      enqueueReady(job);
      pump();
    }
  };

  const pump = () => {
    // Returning responses release memory and disk, including under pressure or shutdown.
    const responseCapacity = Math.max(1, accepting ? currentMaxConcurrent : drainConcurrency);

    while (resumptions.length && active < responseCapacity) resumptions.shift()!();

    if (!accepting || waiting >= waitingLimit) return;

    if (handlers.size === 0 && ![...workspaceQueues.values()].some((queue) => queue[0] && isTransient(queue[0])))
      return;
    let skipped = 0;

    while (active < currentMaxConcurrent && waiting < waitingLimit && readyWorkspaces.length > skipped) {
      const workspaceId = readyWorkspaces.shift()!;
      const workspaceActive = activeByWorkspace.get(workspaceId) ?? 0;
      const queue = workspaceQueues.get(workspaceId);
      // Packet fan-out must not leave ready child extractions behind an entire
      // upload backlog. Alternate stages, preserving FIFO within each stage.
      const previousPacket = lastWasPacket.get(workspaceId);

      const alternate =
        previousPacket === undefined
          ? -1
          : (queue?.findIndex((item) => (item.kind === "packet") !== previousPacket) ?? -1);

      const nextIndex = alternate < 0 ? 0 : alternate;
      const first = queue?.[nextIndex];

      if (
        workspaceActive >= getWorkspaceMaxConcurrent(workspaceId) ||
        (first && !isTransient(first) && handlers.size === 0)
      ) {
        readyWorkspaces.push(workspaceId);
        skipped += 1;
        continue;
      }

      skipped = 0;
      readyWorkspaceSet.delete(workspaceId);
      const job = queue?.splice(nextIndex, 1)[0];

      if (!job) {
        workspaceQueues.delete(workspaceId);
        continue;
      }

      lastWasPacket.set(workspaceId, job.kind === "packet");
      pending -= 1;

      if (queue!.length > 0) {
        readyWorkspaceSet.add(workspaceId);
        readyWorkspaces.push(workspaceId);
      } else {
        workspaceQueues.delete(workspaceId);
      }

      active += 1;
      inFlight += 1;
      let suspended = false;
      let finished = false;
      let resumption: Promise<void> | undefined;
      let finishResumption: (() => void) | undefined;

      const capacity: LocalProcessingCapacity = {
        suspend: () => {
          if (suspended || finished) return;
          suspended = true;
          active -= 1;
          waiting += 1;
          // Avoid recursively starting handlers which immediately suspend.
          queueMicrotask(pump);
        },
        resume: () => {
          if (!suspended || finished) return Promise.resolve();

          if (resumption) return resumption;
          resumption = new Promise<void>((resolve) => {
            finishResumption = () => {
              if (!finished) {
                suspended = false;
                waiting -= 1;
                active += 1;
              }

              resumption = undefined;
              finishResumption = undefined;
              resolve();
            };

            resumptions.push(finishResumption);
          });
          const result = resumption;
          pump();

          return result;
        },
      };

      activeByWorkspace.set(workspaceId, workspaceActive + 1);
      void (async () => {
        if (isTransient(job)) await Promise.resolve().then(() => job.run());
        else await Promise.all(Array.from(handlers, (handler) => handler(job, capacity)));
      })()
        .catch((error) => {
          if (isTransient(job)) job.discard();
          else onHandlerError(error, job);
        })
        .finally(() => {
          finished = true;
          inFlight -= 1;

          if (suspended) waiting -= 1;
          else active -= 1;

          if (finishResumption) {
            const index = resumptions.indexOf(finishResumption);

            if (index >= 0) resumptions.splice(index, 1);
            finishResumption();
          }

          const remaining = (activeByWorkspace.get(workspaceId) ?? 1) - 1;

          if (remaining) activeByWorkspace.set(workspaceId, remaining);
          else activeByWorkspace.delete(workspaceId);
          knownJobs.delete(jobKey(job));
          pump();
          settleIdle();
          settleClose();

          if (!activeByWorkspace.has(workspaceId) && !workspaceQueues.has(workspaceId))
            lastWasPacket.delete(workspaceId);

          if (accepting && !activeByWorkspace.has(workspaceId) && !workspaceQueues.has(workspaceId)) {
            void Promise.resolve()
              .then(() => onWorkspaceIdle?.(workspaceId))
              .catch((error) => {
                if (!isTransient(job)) onHandlerError(error, job);
              });
          }

          if (accepting && overflowed && pending + deferredJobs.length < Math.max(1, normalizedMaxBuffered / 2)) {
            overflowed = false;
            void Promise.resolve()
              .then(() => onCapacityAvailable?.())
              .catch((error) => {
                if (!isTransient(job)) onHandlerError(error, job);
              });
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
    deferredTimer = scheduleTimer(
      () => {
        const firedDueAt = nextDueAt;
        deferredTimer = null;
        deferredTimerDueAt = null;
        const due = deferredJobs.filter((entry) => entry.dueAt <= firedDueAt);
        deferredJobs.splice(0, due.length);

        for (const entry of due) enqueueReady(entry.job);
        pump();
        armDeferredTimer();
      },
      Math.max(0, nextDueAt - now()),
    );
  };

  return {
    close: async () => {
      if (accepting) {
        drainConcurrency = Math.max(1, currentMaxConcurrent);
        accepting = false;
        currentMaxConcurrent = 0;

        if (deferredTimer !== null) cancelTimer(deferredTimer);
        deferredTimer = null;
        deferredTimerDueAt = null;

        for (const { job } of deferredJobs) if (isTransient(job)) job.discard();

        for (const queue of workspaceQueues.values()) for (const job of queue) if (isTransient(job)) job.discard();
        deferredJobs.splice(0);
        workspaceQueues.clear();
        lastWasPacket.clear();
        pending = 0;
        readyWorkspaces.splice(0);
        readyWorkspaceSet.clear();
        knownJobs.clear();
        settleIdle();
      }

      if (inFlight === 0) return;
      await new Promise<void>((resolve) => closeWaiters.push(resolve));
    },
    schedule: async (job) => {
      if (!accepting) {
        durableDeferrals += 1;

        return;
      }

      if (knownJobs.has(jobKey(job))) return;

      if (pending + deferredJobs.length >= normalizedMaxBuffered) {
        durableDeferrals += 1;
        overflowed = true;

        return;
      }

      admit(job);
    },
    scheduleTransient: (task) => {
      if (!accepting) return "closed";

      if (knownJobs.has(jobKey(task))) return "duplicate";

      if (pending + deferredJobs.length >= normalizedMaxBuffered) return "full";
      admit(task);

      return "accepted";
    },
    discardTransient: (owner) => {
      const remove = (job: ScheduledWork) => {
        if (!isTransient(job) || job.owner !== owner) return false;
        knownJobs.delete(jobKey(job));
        job.discard();

        return true;
      };

      for (const [id, queue] of workspaceQueues) {
        const remaining = queue.filter((job) => !remove(job));
        pending -= queue.length - remaining.length;

        if (remaining.length) workspaceQueues.set(id, remaining);
        else {
          workspaceQueues.delete(id);
          readyWorkspaceSet.delete(id);
          const index = readyWorkspaces.indexOf(id);

          if (index >= 0) readyWorkspaces.splice(index, 1);
        }
      }

      for (let i = deferredJobs.length - 1; i >= 0; i--) {
        if (remove(deferredJobs[i].job)) deferredJobs.splice(i, 1);
      }

      armDeferredTimer();
      pump();
      settleIdle();
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
      waiting,
      inFlight,
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
      if (inFlight === 0 && pending === 0 && deferredJobs.length === 0) return;
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

function jobKey(job: ScheduledWork): string {
  return (
    (isTransient(job) ? "evaluation:" : "document:") + `${job.workspace_id}\u0000${job.job_id}\u0000${job.attempt ?? 1}`
  );
}

function oldestEnqueuedAt(workspaceQueues: Map<string, ScheduledWork[]>, deferredJobs: DeferredJob[]): string | null {
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
