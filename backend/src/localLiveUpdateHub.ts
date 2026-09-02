export type LocalLiveUpdateSocket = {
  close?(code?: number, reason?: string): void;
  send(message: string): number;
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
    reason: "workspace_access" | "model_configuration_changed";
    occurredAt: string;
  }): void;
  broadcastJob(workspaceId: string, job: LocalLiveUpdateJob): void;
  closeAll(): void;
  diagnostics(): {
    connections: { closed: number; open: number; opened: number; pending: number };
    delivery: { backpressured: number; delivered: number; dropped: number; failed: number };
    workspaces: {
      maximumSubscribers: number;
      minimumSubscribers: number;
      total: number;
      totalSubscribers: number;
    };
  };
  drain(socket: LocalLiveUpdateSocket): void;
  subscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): () => void;
  unsubscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): void;
};

export function createLocalLiveUpdateHub(): LocalLiveUpdateHub {
  const socketsByWorkspace = new Map<string, Set<LocalLiveUpdateSocket>>();
  const openSockets = new Set<LocalLiveUpdateSocket>();
  const pendingSockets = new Set<LocalLiveUpdateSocket>();
  const delivery = { backpressured: 0, delivered: 0, dropped: 0, failed: 0 };
  let connectionsClosed = 0;
  let connectionsOpened = 0;
  let closed = false;

  function unsubscribe(input: { workspaceId: string; socket: LocalLiveUpdateSocket }): void {
    const sockets = socketsByWorkspace.get(input.workspaceId);
    if (!sockets) {
      return;
    }
    sockets.delete(input.socket);
    if (sockets.size === 0) {
      socketsByWorkspace.delete(input.workspaceId);
    }
    pendingSockets.delete(input.socket);
    if (openSockets.delete(input.socket)) connectionsClosed += 1;
  }

  function deliver(
    workspaceId: string,
    sockets: Set<LocalLiveUpdateSocket>,
    message: string,
  ): void {
    for (const socket of sockets) {
      try {
        const status = socket.send(message);
        if (status > 0) {
          delivery.delivered += 1;
        } else if (status === -1) {
          delivery.backpressured += 1;
          pendingSockets.add(socket);
        } else {
          delivery.dropped += 1;
          unsubscribe({ workspaceId, socket });
          socket.close?.(1011, "Live update delivery failed");
        }
      } catch {
        delivery.failed += 1;
        unsubscribe({ workspaceId, socket });
        socket.close?.(1011, "Live update delivery failed");
      }
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
      deliver(workspaceId, sockets, message);
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
      deliver(workspaceId, sockets, message);
    },
    closeAll: () => {
      if (closed) return;
      closed = true;
      const sockets = new Set(openSockets);
      socketsByWorkspace.clear();
      openSockets.clear();
      pendingSockets.clear();
      connectionsClosed += sockets.size;
      for (const socket of sockets) {
        socket.close?.(1001, "Local Bun Runtime shutting down");
      }
    },
    diagnostics: () => {
      const subscriberCounts = [...socketsByWorkspace.values()].map((sockets) => sockets.size);
      return {
        connections: {
          closed: connectionsClosed,
          open: openSockets.size,
          opened: connectionsOpened,
          pending: pendingSockets.size,
        },
        delivery: { ...delivery },
        workspaces: {
          maximumSubscribers: subscriberCounts.length ? Math.max(...subscriberCounts) : 0,
          minimumSubscribers: subscriberCounts.length ? Math.min(...subscriberCounts) : 0,
          total: subscriberCounts.length,
          totalSubscribers: subscriberCounts.reduce((total, count) => total + count, 0),
        },
      };
    },
    drain: (socket) => {
      pendingSockets.delete(socket);
    },
    subscribe: ({ workspaceId, socket }) => {
      if (closed) {
        socket.close?.(1001, "Local Bun Runtime shutting down");
        return () => {};
      }
      const sockets = socketsByWorkspace.get(workspaceId) ?? new Set<LocalLiveUpdateSocket>();
      if (!sockets.has(socket)) {
        sockets.add(socket);
        openSockets.add(socket);
        connectionsOpened += 1;
      }
      socketsByWorkspace.set(workspaceId, sockets);
      return () => unsubscribe({ workspaceId, socket });
    },
    unsubscribe,
  };
}
