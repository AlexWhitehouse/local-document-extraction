export class LocalWorkspaceOperationError extends Error {
  constructor(
    public readonly code: "job_deleting" | "workspace_deleting",
    message: string,
  ) {
    super(message);
  }
}

export type LocalWorkspaceProductOperation = {
  release(): void;
  signal: AbortSignal;
};

export type LocalWorkspaceProductOperations = {
  acquire(input: { workspaceId: string; jobId?: string }): LocalWorkspaceProductOperation;
  beginDocumentDeletion(input: { workspaceId: string; jobId: string }): Promise<void>;
  completeDocumentDeletion(input: { workspaceId: string; jobId: string }): void;
  failDocumentDeletion(input: { workspaceId: string; jobId: string }): void;
  beginDeletion(input: { workspaceId: string }): Promise<void>;
  completeDeletion(input: { workspaceId: string }): void;
  failDeletion(input: { workspaceId: string }): void;
};

type OperationState = {
  activeOperations: number;
  deleting: boolean;
  idleWaiters: Array<() => void>;
  abortControllers: Set<AbortController>;
};

type WorkspaceOperationState = OperationState & { jobs: Map<string, OperationState> };

export function createLocalWorkspaceProductOperations(): LocalWorkspaceProductOperations {
  const states = new Map<string, WorkspaceOperationState>();

  const workspaceState = (workspaceId: string): WorkspaceOperationState => {
    let state = states.get(workspaceId);
    if (!state) {
      state = { ...newOperationState(), jobs: new Map() };
      states.set(workspaceId, state);
    }
    if (state.deleting) {
      throw new LocalWorkspaceOperationError("workspace_deleting", "Workspace deletion is in progress");
    }
    return state;
  };

  const jobState = (state: WorkspaceOperationState, jobId: string): OperationState => {
    let job = state.jobs.get(jobId);
    if (!job) {
      job = newOperationState();
      state.jobs.set(jobId, job);
    }
    if (job.deleting) {
      throw new LocalWorkspaceOperationError("job_deleting", "Document deletion is in progress");
    }
    return job;
  };

  const settleWorkspace = (workspaceId: string, state: WorkspaceOperationState) => {
    if (!settle(state)) return;
    if (!state.deleting && state.jobs.size === 0) states.delete(workspaceId);
  };

  const finishDocumentDeletion = ({ workspaceId, jobId }: { workspaceId: string; jobId: string }) => {
    const state = states.get(workspaceId);
    if (!state) return;
    state.jobs.delete(jobId);
    settleWorkspace(workspaceId, state);
  };

  return {
    acquire: ({ workspaceId, jobId }) => {
      const state = workspaceState(workspaceId);
      const job = jobId ? jobState(state, jobId) : null;
      const abortController = new AbortController();
      for (const target of job ? [state, job] : [state]) {
        target.activeOperations += 1;
        target.abortControllers.add(abortController);
      }
      let released = false;
      return {
        signal: abortController.signal,
        release: () => {
          if (released) return;
          released = true;
          state.activeOperations -= 1;
          state.abortControllers.delete(abortController);
          if (job && jobId) {
            job.activeOperations -= 1;
            job.abortControllers.delete(abortController);
            if (settle(job) && !job.deleting) state.jobs.delete(jobId);
          }
          settleWorkspace(workspaceId, state);
        },
      };
    },
    beginDocumentDeletion: async ({ workspaceId, jobId }) => {
      const idle = markDeleting(jobState(workspaceState(workspaceId), jobId));
      if (idle) await idle;
    },
    completeDocumentDeletion: finishDocumentDeletion,
    failDocumentDeletion: finishDocumentDeletion,
    beginDeletion: async ({ workspaceId }) => {
      const idle = markDeleting(workspaceState(workspaceId));
      if (idle) await idle;
    },
    completeDeletion: ({ workspaceId }) => {
      states.delete(workspaceId);
    },
    failDeletion: () => {
      // Keep the Workspace closed to new product work after a failed deletion.
    },
  };
}

function newOperationState(): OperationState {
  return { activeOperations: 0, abortControllers: new Set(), deleting: false, idleWaiters: [] };
}

/** Aborts in-flight work and returns a promise for it to drain, or null when already idle. */
function markDeleting(state: OperationState): Promise<void> | null {
  state.deleting = true;
  for (const abortController of state.abortControllers) abortController.abort();
  if (state.activeOperations === 0) return null;
  return new Promise<void>((resolve) => state.idleWaiters.push(resolve));
}

/** Wakes deletion waiters once no operations remain; returns whether the state is idle. */
function settle(state: OperationState): boolean {
  if (state.activeOperations !== 0) return false;
  for (const resolve of state.idleWaiters.splice(0)) resolve();
  return true;
}
