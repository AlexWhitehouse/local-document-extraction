export type LocalQueuedExtractionJob = {
  job_id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  enqueued_at: string;
  attempt?: number;
  not_before?: string;
};

export type LocalExtractionQueue = {
  schedule(job: LocalQueuedExtractionJob): Promise<void>;
  subscribe(handler: (job: LocalQueuedExtractionJob) => void | Promise<void>): () => void;
};

export function createLocalExtractionQueue({
  now = Date.now,
  scheduleTimer = (handler, delayMs) => {
    setTimeout(handler, delayMs);
  },
}: {
  now?: () => number;
  scheduleTimer?: (handler: () => void, delayMs: number) => void;
} = {}): LocalExtractionQueue {
  const handlers = new Set<(job: LocalQueuedExtractionJob) => void | Promise<void>>();

  const dispatch = (job: LocalQueuedExtractionJob) => {
    for (const handler of handlers) {
      const result = handler(job);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void Promise.resolve(result).catch((error) => {
          console.error("Local extraction queue handler failed", error);
        });
      }
    }
  };

  return {
    schedule: async (job) => {
      const notBeforeMs = job.not_before ? Date.parse(job.not_before) : Number.NaN;
      const delayMs = Number.isFinite(notBeforeMs)
        ? Math.max(0, notBeforeMs - now())
        : 0;
      if (delayMs > 0) {
        scheduleTimer(() => dispatch(job), delayMs);
        return;
      }
      dispatch(job);
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
