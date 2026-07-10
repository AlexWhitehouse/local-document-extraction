type LocalLiveUpdateSocket = {
  send(message: string): void;
};

type LocalLiveUpdateJob = {
  job_id: string;
  status: string;
  template_id: string;
  template_version: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_attempt: number;
  completed_attempt: number;
  last_failed_attempt: number;
  [key: string]: unknown;
};

export type LocalLiveUpdateHub = {
  broadcastWorkspaceContextInvalidation(input: {
    workspaceId: string;
    reason: "workspace_access";
    occurredAt: string;
  }): void;
  broadcastJob(workspaceId: string, job: LocalLiveUpdateJob): void;
  subscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): () => void;
  unsubscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): void;
};

export function createLocalLiveUpdateHub(): LocalLiveUpdateHub {
  const socketsByWorkspace = new Map<string, Set<LocalLiveUpdateSocket>>();

  function unsubscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): void {
    const sockets = socketsByWorkspace.get(input.workspaceId);
    if (!sockets) {
      return;
    }
    sockets.delete(input.socket);
    if (sockets.size === 0) {
      socketsByWorkspace.delete(input.workspaceId);
    }
  }

  return {
    broadcastWorkspaceContextInvalidation: ({ workspaceId, reason, occurredAt }) => {
      const sockets = socketsByWorkspace.get(workspaceId);
      if (!sockets?.size) {
        return;
      }
      const message = JSON.stringify({
        version: 1,
        events: [{
          type: "workspace_context_invalidated",
          reason,
          occurred_at: occurredAt,
        }],
      });
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch {
          unsubscribe({ workspaceId, socket });
        }
      }
    },
    broadcastJob: (workspaceId, job) => {
      const sockets = socketsByWorkspace.get(workspaceId);
      if (!sockets?.size) {
        return;
      }
      const message = JSON.stringify({
        version: 1,
        events: [{
          type: "extraction_job_lifecycle",
          job: {
            job_id: job.job_id,
            status: job.status,
            template_id: job.template_id,
            template_version: job.template_version,
            error_code: job.error_code,
            error_message: job.error_message,
            created_at: job.created_at,
            updated_at: job.updated_at,
            completed_at: job.completed_at,
            current_attempt: job.current_attempt,
            completed_attempt: job.completed_attempt,
            last_failed_attempt: job.last_failed_attempt,
          },
        }],
      });
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch {
          unsubscribe({ workspaceId, socket });
        }
      }
    },
    subscribe: ({ workspaceId, socket }) => {
      const sockets = socketsByWorkspace.get(workspaceId) ?? new Set<LocalLiveUpdateSocket>();
      sockets.add(socket);
      socketsByWorkspace.set(workspaceId, sockets);
      return () => unsubscribe({ workspaceId, socket });
    },
    unsubscribe,
  };
}
