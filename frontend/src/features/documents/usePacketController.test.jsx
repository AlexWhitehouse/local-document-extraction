import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePacketController } from "./usePacketController.js";

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const packet = { packet_id: "p1", source_name: "packet.pdf", status: "awaiting_review", plan_revision: 1 };
function setup(overrides = {}) {
  const requests = {
    listPackets: vi.fn(async () => ({ packets: [packet] })), getPacket: vi.fn(async () => packet),
    confirmPacketPlan: vi.fn(async () => ({})), deletePacket: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };
  const onJobsChanged = vi.fn();
  const hook = renderHook(({ workspaceId }) => usePacketController({ requests, enabled: true, sessionId: "session", workspaceId, onJobsChanged }), { initialProps: { workspaceId: "workspace-a" } });
  return { ...hook, requests, onJobsChanged };
}

describe("Packet request lifetimes", () => {
  it("ignores a retired workspace's pending packet list and detail", async () => {
    const list = deferred();
    const detail = deferred();
    const { result, rerender, requests } = setup({ listPackets: vi.fn().mockResolvedValueOnce({ packets: [packet] }).mockImplementationOnce(() => list.promise).mockResolvedValue({ packets: [] }), getPacket: vi.fn(() => detail.promise) });
    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => { result.current.select("p1"); void result.current.refresh(); });
    rerender({ workspaceId: "workspace-b" });
    await waitFor(() => expect(requests.listPackets).toHaveBeenCalledTimes(3));
    await act(async () => { list.resolve({ packets: [packet] }); detail.resolve(packet); });
    expect(result.current.packets).toEqual([]);
    expect(result.current.selectedId).toBe("");
    expect(result.current.selectedPacket).toBeNull();
  });

  it("keeps a revision conflict visible while refreshing the authoritative plan", async () => {
    const { result, requests, onJobsChanged } = setup({ confirmPacketPlan: vi.fn(async () => { throw Object.assign(new Error("Plan changed; review the latest version."), { status: 409 }); }) });
    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => result.current.select("p1"));
    await waitFor(() => expect(result.current.selectedPacket?.plan_revision).toBe(1));
    requests.getPacket.mockResolvedValue({ ...packet, plan_revision: 2 });
    await act(async () => { expect(await result.current.confirmPlan("p1", { revision: 1, groups: [], exclusions: [] })).toBe(false); });
    expect(result.current.selectedPacket.plan_revision).toBe(2);
    expect(result.current.error).toContain("Plan changed");
    expect(result.current.busy).toBe(false);
    expect(onJobsChanged).not.toHaveBeenCalled();
  });

  it("confirms once, reloads the packet, and refreshes child jobs; delete clears selection", async () => {
    const { result, requests, onJobsChanged } = setup();
    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => result.current.select("p1"));
    await act(async () => { expect(await result.current.confirmPlan("p1", { revision: 1, groups: [{ pages: [1] }], exclusions: [] })).toBe(true); });
    expect(requests.confirmPacketPlan).toHaveBeenCalledWith("p1", { revision: 1, groups: [{ pages: [1] }], exclusions: [] });
    expect(onJobsChanged).toHaveBeenCalledTimes(1);
    requests.listPackets.mockResolvedValue({ packets: [] });
    await act(async () => result.current.remove("p1"));
    expect(result.current.selectedId).toBe("");
    expect(result.current.packets).toEqual([]);
    expect(onJobsChanged).toHaveBeenCalledTimes(2);
  });
});
