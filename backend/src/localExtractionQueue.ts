export type LocalQueuedExtractionJob = {
  job_id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  enqueued_at: string;
  attempt?: number;
};

export type LocalExtractionQueue = {
  schedule(job: LocalQueuedExtractionJob): Promise<void>;
  subscribe(handler: (job: LocalQueuedExtractionJob) => void | Promise<void>): () => void;
};

export function createLocalExtractionQueue(): LocalExtractionQueue {
  const handlers = new Set<(job: LocalQueuedExtractionJob) => void | Promise<void>>();

  return {
    schedule: async (job) => {
      for (const handler of handlers) {
        const result = handler(job);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          void Promise.resolve(result).catch((error) => {
            console.error("Local extraction queue handler failed", error);
          });
        }
      }
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
