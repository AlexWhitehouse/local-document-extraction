import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePacketController } from "./usePacketController.js";
import { useState } from "react";
import { flushSync } from "react-dom";

function deferred() {
  let resolve;

  const promise = new Promise((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const packet = { packet_id: "p1", source_name: "packet.pdf", status: "awaiting_review", plan_revision: 1 };

function setup(overrides = {}) {
  const requests = {
    listPackets: vi.fn(async () => ({ packets: [packet] })),
    getPacket: vi.fn(async () => packet),
    confirmPacketPlan: vi.fn(async () => ({})),
    deletePacket: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };

  const onJobsChanged = vi.fn();

  const hook = renderHook(
    ({ workspaceId }) =>
      usePacketController({ requests, enabled: true, sessionId: "session", workspaceId, onJobsChanged }),
    { initialProps: { workspaceId: "workspace-a" } },
  );

  return { ...hook, requests, onJobsChanged };
}

describe("Packet request lifetimes", () => {
  it("refreshes selected details when the combined list completes during an active poll", async () => {
    vi.useFakeTimers();
    const finished = { ...packet, status: "completed", children: [{ job_id: "child", status: "completed" }] };
    const getPacket = vi.fn().mockResolvedValueOnce(packet).mockResolvedValue(finished);

    const { result } = renderHook(() => {
      const [packets, setPackets] = useState([packet]);

      return usePacketController({
        requests: { listPackets: vi.fn(), getPacket },
        enabled: true,
        sessionId: "session",
        workspaceId: "workspace",
        listing: {
          packets,
          loading: false,
          refresh: async () => {
            // Reconciliation publishes synchronously through useSyncExternalStore.
            flushSync(() => setPackets([finished]));
          },
        },
      });
    });

    await act(async () => {
      result.current.select(packet.packet_id);
    });
    expect(result.current.selectedPacket.status).toBe("awaiting_review");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(result.current.packets[0].status).toBe("completed");
    expect(result.current.selectedPacket).toEqual(finished);
    expect(getPacket).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "processing", interval: 6000 },
    { status: "completed", interval: 30000 },
  ])("keeps loaded older packet pages during $status polling", async ({ status, interval }) => {
    vi.useFakeTimers();
    const newer = { ...packet, packet_id: "newer", status, created_at: "2026-10-02T12:00:00Z" };
    const older = { ...packet, packet_id: "older", status, created_at: "2026-10-01T12:00:00Z" };
    const oldest = { ...packet, packet_id: "oldest", status, created_at: "2026-09-30T12:00:00Z" };

    const listPackets = vi.fn(async ({ cursor } = {}) =>
      cursor === "older-cursor"
        ? { packets: [older], has_more: true, next_cursor: "oldest-cursor" }
        : cursor === "oldest-cursor"
          ? { packets: [oldest], has_more: false, next_cursor: null }
          : { packets: [newer], has_more: true, next_cursor: "older-cursor" },
    );

    const hook = setup({ listPackets });
    await act(async () => {});
    await act(async () => {
      await hook.result.current.refresh({ append: true });
    });
    expect(hook.result.current.packets.map((row) => row.packet_id)).toEqual(["newer", "older"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(interval);
    });
    expect(hook.result.current.packets.map((row) => row.packet_id)).toEqual(["newer", "older"]);
    expect(hook.result.current.cursor).toBe("oldest-cursor");
    await act(async () => {
      await hook.result.current.refresh({ append: true });
    });
    expect(hook.result.current.packets.map((row) => row.packet_id)).toEqual(["newer", "older", "oldest"]);
    hook.unmount();
    vi.useRealTimers();
  });

  it("refreshes the loaded range across new uploads and deletions, including a deleted oldest row", async () => {
    const makePacket = (id) => ({ ...packet, packet_id: id, created_at: "2026-10-02T12:00:00Z" });
    let rows = [makePacket("p3"), makePacket("p2"), makePacket("p1")];

    const { result } = setup({
      listPackets: vi.fn(async ({ cursor } = {}) => {
        const remaining = cursor ? rows.filter((row) => row.packet_id < cursor) : rows;
        const page = remaining.slice(0, 2);

        return {
          packets: page,
          has_more: remaining.length > 2,
          next_cursor: remaining.length > 2 ? page.at(-1).packet_id : null,
        };
      }),
      deletePacket: vi.fn(async (id) => {
        rows = rows.filter((row) => row.packet_id !== id);

        return { deleted: true };
      }),
    });

    await waitFor(() => expect(result.current.packets).toHaveLength(2));
    await act(async () => {
      await result.current.refresh({ append: true });
    });
    rows = [makePacket("p4"), makePacket("p3"), { ...makePacket("p1"), status: "completed" }];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.packets.map((row) => row.packet_id)).toEqual(["p4", "p3", "p1"]);
    expect(result.current.packets.at(-1).status).toBe("completed");
    rows = [makePacket("p4"), makePacket("p3"), makePacket("p0")];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.packets.map((row) => row.packet_id)).toEqual(["p4", "p3", "p0"]);
    await act(async () => {
      await result.current.remove("p3");
    });
    expect(result.current.packets.map((row) => row.packet_id)).toEqual(["p4", "p0"]);
  });

  it("does not let polling supersede an in-flight Load more request", async () => {
    vi.useFakeTimers();
    const nextPage = deferred();

    const listPackets = vi.fn(async ({ cursor } = {}) =>
      cursor ? nextPage.promise : { packets: [packet], has_more: true, next_cursor: "older" },
    );

    const hook = setup({ listPackets });
    await act(async () => {});
    let loadingMore;
    act(() => {
      loadingMore = hook.result.current.refresh({ append: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(listPackets).toHaveBeenCalledTimes(2);
    await act(async () => {
      nextPage.resolve({ packets: [{ ...packet, packet_id: "p0" }] });
      await loadingMore;
    });
    expect(hook.result.current.packets.map((row) => row.packet_id)).toEqual(["p1", "p0"]);
    hook.unmount();
    vi.useRealTimers();
  });

  it("ignores a retired workspace's later page while refreshing loaded history", async () => {
    const older = { ...packet, packet_id: "p0" };
    const laterPage = deferred();
    let pending = false;
    let retired = false;

    const listPackets = vi.fn(async ({ cursor } = {}) =>
      retired
        ? { packets: [] }
        : cursor
          ? pending
            ? laterPage.promise
            : { packets: [older] }
          : { packets: [packet], has_more: true, next_cursor: "older" },
    );

    const { result, rerender } = setup({ listPackets });
    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    await act(async () => {
      await result.current.refresh({ append: true });
    });
    pending = true;
    let refreshing;
    await act(async () => {
      refreshing = result.current.refresh();
    });
    expect(listPackets).toHaveBeenCalledTimes(4);
    retired = true;
    rerender({ workspaceId: "workspace-b" });
    await waitFor(() => expect(listPackets).toHaveBeenCalledTimes(5));
    await act(async () => {
      laterPage.resolve({ packets: [older], has_more: true, next_cursor: "even-older" });
      await refreshing;
    });
    expect(result.current.packets).toEqual([]);
    expect(result.current.cursor).toBeNull();
    expect(listPackets).toHaveBeenCalledTimes(5);
  });

  it("ignores a retired workspace's pending packet list and detail", async () => {
    const list = deferred();
    const detail = deferred();

    const { result, rerender, requests } = setup({
      listPackets: vi
        .fn()
        .mockResolvedValueOnce({ packets: [packet] })
        .mockImplementationOnce(() => list.promise)
        .mockResolvedValue({ packets: [] }),
      getPacket: vi.fn(() => detail.promise),
    });

    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => {
      result.current.select("p1");
      void result.current.refresh();
    });
    rerender({ workspaceId: "workspace-b" });
    await waitFor(() => expect(requests.listPackets).toHaveBeenCalledTimes(3));
    await act(async () => {
      list.resolve({ packets: [packet] });
      detail.resolve(packet);
    });
    expect(result.current.packets).toEqual([]);
    expect(result.current.selectedId).toBe("");
    expect(result.current.selectedPacket).toBeNull();
  });

  it("keeps a revision conflict visible while refreshing the authoritative plan", async () => {
    const { result, requests, onJobsChanged } = setup({
      confirmPacketPlan: vi.fn(async () => {
        throw Object.assign(new Error("Plan changed; review the latest version."), { status: 409 });
      }),
    });

    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => result.current.select("p1"));
    await waitFor(() => expect(result.current.selectedPacket?.plan_revision).toBe(1));
    requests.getPacket.mockResolvedValue({ ...packet, plan_revision: 2 });
    await act(async () => {
      expect(await result.current.confirmPlan("p1", { revision: 1, groups: [], exclusions: [] })).toBe(false);
    });
    expect(result.current.selectedPacket.plan_revision).toBe(2);
    expect(result.current.error).toContain("Plan changed");
    expect(result.current.busy).toBe(false);
    expect(onJobsChanged).not.toHaveBeenCalled();
  });

  it("confirms once, reloads the packet, and refreshes child jobs; delete clears selection", async () => {
    const { result, requests, onJobsChanged } = setup();
    await waitFor(() => expect(result.current.packets).toHaveLength(1));
    act(() => result.current.select("p1"));
    await act(async () => {
      expect(await result.current.confirmPlan("p1", { revision: 1, groups: [{ pages: [1] }], exclusions: [] })).toBe(
        true,
      );
    });
    expect(requests.confirmPacketPlan).toHaveBeenCalledWith("p1", {
      revision: 1,
      groups: [{ pages: [1] }],
      exclusions: [],
    });
    expect(onJobsChanged).toHaveBeenCalledTimes(1);
    requests.listPackets.mockResolvedValue({ packets: [] });
    await act(async () => result.current.remove("p1"));
    expect(result.current.selectedId).toBe("");
    expect(result.current.packets).toEqual([]);
    expect(onJobsChanged).toHaveBeenCalledTimes(2);
  });
});
