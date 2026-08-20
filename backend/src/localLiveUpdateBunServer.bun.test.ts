import { expect, test } from "bun:test";

import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY } from "./localLiveUpdatePolicy";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";

test("the Bun server keeps a bounded receive-only Workspace socket and delivers lifecycle messages", async () => {
  const hub = createLocalLiveUpdateHub();
  const auth = {
    getSession: async () => ({ id: "user_ada", email: "ada@example.com", name: "Ada" }),
  };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      workspaceId === "workspace_research" && userId === "user_ada" ? { id: workspaceId } : null,
  };
  const server = Bun.serve<{ workspaceId: string }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, bunServer) => upgradeLocalLiveUpdate({
      auth: auth as never,
      request,
      server: bunServer,
      workspaceControl: workspaceControl as never,
    }),
    websocket: {
      ...LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY,
      close: (socket) => {
        hub.unsubscribe({ workspaceId: socket.data.workspaceId, socket });
      },
      drain: (socket) => hub.drain(socket),
      message: (socket) => socket.close(1008, "Workspace live updates are receive-only"),
      open: (socket) => {
        hub.subscribe({ workspaceId: socket.data.workspaceId, socket });
      },
    },
  });

  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/v1/workspaces/workspace_research/live`);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Live update WebSocket failed to open"));
    });
    expect(LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY.idleTimeout).toBeGreaterThan(120);
    await Bun.sleep(20);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    const message = new Promise<string>((resolve, reject) => {
      socket.onmessage = (event) => resolve(String(event.data));
      socket.onerror = () => reject(new Error("Live update WebSocket failed while receiving"));
    });
    hub.broadcastJob("workspace_research", {
      job_id: "job_invoice",
      status: "processing",
      template_id: "tpl_invoice",
      template_version: 1,
      error_code: null,
      error_message: null,
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:01:00.000Z",
      completed_at: null,
      current_attempt: 1,
      completed_attempt: 0,
      last_failed_attempt: 0,
    });

    await expect(message).resolves.toContain('"status":"processing"');
    socket.close();
    await waitFor(() => hub.diagnostics().connections.open === 0);

    const supportedInbound = await openSocket(server.port!);
    const supportedClose = closed(supportedInbound);
    supportedInbound.send("client-message");
    await expect(supportedClose).resolves.toBe(1008);

    const oversizedInbound = await openSocket(server.port!);
    const oversizedClose = closed(oversizedInbound);
    oversizedInbound.send("x".repeat(LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY.maxPayloadLength + 1));
    // Bun 1.4 enforces maxPayloadLength by terminating the connection; the
    // browser-facing client observes the runtime close as 1006, not a 1009 frame.
    await expect(oversizedClose).resolves.toBe(1006);
    await waitFor(() => hub.diagnostics().connections.open === 0);
    expect(hub.diagnostics().connections).toMatchObject({ open: 0, opened: 3, closed: 3 });
    expect(server.pendingWebSockets).toBe(0);
  } finally {
    await server.stop(true);
  }
});

async function openSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/workspaces/workspace_research/live`);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Live update WebSocket failed to open"));
  });
  return socket;
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.onclose = (event) => resolve(event.code);
    socket.onerror = () => reject(new Error("Live update WebSocket failed before close"));
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(2);
  }
  throw new Error("Timed out waiting for live update socket cleanup");
}
