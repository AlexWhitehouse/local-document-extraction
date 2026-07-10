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

type JobOperationState = {
  activeOperations: number;
  deleting: boolean;
  idleWaiters: Array<() => void>;
  abortControllers: Set<AbortController>;
};

type WorkspaceOperationState = {
  activeOperations: number;
  deleting: boolean;
  idleWaiters: Array<() => void>;
  abortControllers: Set<AbortController>;
  jobs: Map<string, JobOperationState>;
};

export function createLocalWorkspaceProductOperations(): LocalWorkspaceProductOperations {
  const states = new Map<string, WorkspaceOperationState>();

  return {
    acquire: ({ workspaceId, jobId }) => {
      const state = stateFor(states, workspaceId);
      if (state.deleting) {
        throw new LocalWorkspaceOperationError("workspace_deleting", "Workspace deletion is in progress");
      }
      const jobState = jobId ? jobStateFor(state, jobId) : null;
      if (jobState?.deleting) {
        throw new LocalWorkspaceOperationError("job_deleting", "Document deletion is in progress");
      }

      const abortController = new AbortController();
      state.activeOperations += 1;
      state.abortControllers.add(abortController);
      if (jobState) {
        jobState.activeOperations += 1;
        jobState.abortControllers.add(abortController);
      }
      let released = false;
      return {
        signal: abortController.signal,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          state.activeOperations -= 1;
          state.abortControllers.delete(abortController);
          if (jobState && jobId) {
            jobState.activeOperations -= 1;
            jobState.abortControllers.delete(abortController);
            settleJobState(state, jobId, jobState);
          }
          settleWorkspaceState(states, workspaceId, state);
        },
      };
    },
    beginDocumentDeletion: async ({ workspaceId, jobId }) => {
      const state = stateFor(states, workspaceId);
      if (state.deleting) {
        throw new LocalWorkspaceOperationError("workspace_deleting", "Workspace deletion is in progress");
      }
      const jobState = jobStateFor(state, jobId);
      if (jobState.deleting) {
        throw new LocalWorkspaceOperationError("job_deleting", "Document deletion is in progress");
      }
      jobState.deleting = true;
      for (const abortController of jobState.abortControllers) {
        abortController.abort();
      }
      if (jobState.activeOperations === 0) {
        return;
      }
      await new Promise<void>((resolve) => jobState.idleWaiters.push(resolve));
    },
    completeDocumentDeletion: ({ workspaceId, jobId }) => {
      const state = states.get(workspaceId);
      if (!state) {
        return;
      }
      state.jobs.delete(jobId);
      settleWorkspaceState(states, workspaceId, state);
    },
    failDocumentDeletion: ({ workspaceId, jobId }) => {
      const state = states.get(workspaceId);
      if (!state) {
        return;
      }
      state.jobs.delete(jobId);
      settleWorkspaceState(states, workspaceId, state);
    },
    beginDeletion: async ({ workspaceId }) => {
      const state = stateFor(states, workspaceId);
      if (state.deleting) {
        throw new LocalWorkspaceOperationError("workspace_deleting", "Workspace deletion is in progress");
      }
      state.deleting = true;
      for (const abortController of state.abortControllers) {
        abortController.abort();
      }
      if (state.activeOperations === 0) {
        return;
      }
      await new Promise<void>((resolve) => state.idleWaiters.push(resolve));
    },
    completeDeletion: ({ workspaceId }) => {
      states.delete(workspaceId);
    },
    failDeletion: () => {
      // Keep the Workspace closed to new product work after a failed deletion.
    },
  };
}

function stateFor(states: Map<string, WorkspaceOperationState>, workspaceId: string): WorkspaceOperationState {
  const existing = states.get(workspaceId);
  if (existing) {
    return existing;
  }
  const state: WorkspaceOperationState = {
    activeOperations: 0,
    abortControllers: new Set(),
    deleting: false,
    idleWaiters: [],
    jobs: new Map(),
  };
  states.set(workspaceId, state);
  return state;
}

function jobStateFor(state: WorkspaceOperationState, jobId: string): JobOperationState {
  const existing = state.jobs.get(jobId);
  if (existing) {
    return existing;
  }
  const jobState: JobOperationState = {
    activeOperations: 0,
    abortControllers: new Set(),
    deleting: false,
    idleWaiters: [],
  };
  state.jobs.set(jobId, jobState);
  return jobState;
}

function settleJobState(
  state: WorkspaceOperationState,
  jobId: string,
  jobState: JobOperationState,
): void {
  if (jobState.activeOperations !== 0) {
    return;
  }
  for (const resolve of jobState.idleWaiters.splice(0)) {
    resolve();
  }
  if (!jobState.deleting) {
    state.jobs.delete(jobId);
  }
}

function settleWorkspaceState(
  states: Map<string, WorkspaceOperationState>,
  workspaceId: string,
  state: WorkspaceOperationState,
): void {
  if (state.activeOperations !== 0) {
    return;
  }
  for (const resolve of state.idleWaiters.splice(0)) {
    resolve();
  }
  if (!state.deleting && state.jobs.size === 0) {
    states.delete(workspaceId);
  }
}
