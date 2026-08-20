import { expect, test } from "bun:test";

import { LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY } from "./localLiveUpdatePolicy";

test("the receive-only Workspace live update policy is quiet-client safe and tightly bounded", async () => {
  expect(LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY).toEqual({
    backpressureLimit: 64 * 1024,
    closeOnBackpressureLimit: true,
    idleTimeout: 300,
    maxPayloadLength: 64,
    sendPings: true,
  });
  expect(LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY.idleTimeout).toBeGreaterThan(120);

  const source = await Bun.file(new URL("./server.ts", import.meta.url)).text();
  expect(source).toContain("...LOCAL_LIVE_UPDATE_WEBSOCKET_POLICY");
  expect(source).toContain("localLiveUpdateHub.drain(socket)");
  expect(source).toContain('socket.close(1008, "Workspace live updates are receive-only")');
});
