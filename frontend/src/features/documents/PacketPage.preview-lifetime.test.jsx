import React, { useMemo } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PacketPage } from "./PacketPage.jsx";
import { createDocumentRequestAdapter } from "./documentRequestAdapter.js";
import { usePacketController } from "./usePacketController.js";

const packet = {
  packet_id: "packet_slow_preview",
  source_name: "mixed.pdf",
  status: "awaiting_review",
  plan_revision: 1,
  selected_pages: [1, 2],
  plan: { groups: [{ pages: [1, 2] }], exclusions: [] },
};

function Harness({ request, replaceAdapter, sessionId = "session", workspaceId = "workspace", enabled = true }) {
  const stableAdapter = useMemo(() => createDocumentRequestAdapter({ request }), [request]);
  // App can replace its request adapter during a render without changing Workspace or session.
  const requests = replaceAdapter ? createDocumentRequestAdapter({ request }) : stableAdapter;
  const controller = usePacketController({ requests, sessionId, workspaceId, enabled });

  return (
    <>
      <button onClick={() => controller.select(packet.packet_id)}>Open packet</button>
      {controller.selectedPacket ? (
        <PacketPage packet={controller.selectedPacket} loadPagePreview={controller.loadPagePreview} />
      ) : null}
    </>
  );
}

function createRequests() {
  const previews = [];

  const request = vi.fn(async (path, options) => {
    if (path.endsWith("/preview")) {
      return new Promise((resolve, reject) => {
        previews.push({ path, signal: options.signal, resolve, reject });
      });
    }

    if (path === "/packets") return { packets: [packet] };

    if (path === `/packets/${packet.packet_id}`) return { ...packet };
    throw new Error(`Unexpected request ${path}`);
  });

  return { request, previews };
}

async function openPacket() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open packet" }));
  });
}

describe("Packet preview request lifetime", () => {
  for (const replaceAdapter of [false, true]) {
    it(`keeps a slow preview alive through polling with ${replaceAdapter ? "replaced" : "stable"} request adapters`, async () => {
      vi.useFakeTimers();
      const { request, previews } = createRequests();
      await act(async () => {
        render(<Harness request={request} replaceAdapter={replaceAdapter} />);
      });
      await openPacket();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(request.mock.calls.filter(([path]) => path === "/packets")).toHaveLength(2);
      expect(previews).toHaveLength(1);
      expect(previews[0].signal.aborted).toBe(false);
    });
  }

  it("retries on request and cancels a pending preview when the original page changes", async () => {
    const { request, previews } = createRequests();
    let view;
    await act(async () => {
      view = render(<Harness request={request} replaceAdapter />);
    });
    await openPacket();
    await act(async () => {
      previews[0].reject(new Error("Document preview is busy; try again shortly"));
    });
    expect(screen.getByText("Document preview is busy; try again shortly")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    });
    expect(previews).toHaveLength(2);
    expect(previews[1].path).toBe(`/packets/${packet.packet_id}/pages/1/preview`);
    expect(previews[1].signal.aborted).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    });
    expect(previews[1].signal.aborted).toBe(true);
    expect(previews).toHaveLength(3);
    expect(previews[2].path).toBe(`/packets/${packet.packet_id}/pages/2/preview`);
    view.unmount();
    expect(previews[2].signal.aborted).toBe(true);
  });

  for (const change of [{ workspaceId: "another-workspace" }, { sessionId: "another-session" }, { enabled: false }]) {
    it(`cancels a pending preview when ${Object.keys(change)[0]} changes`, async () => {
      const { request, previews } = createRequests();
      let view;
      await act(async () => {
        view = render(<Harness request={request} replaceAdapter />);
      });
      await openPacket();
      expect(previews).toHaveLength(1);
      expect(previews[0].signal.aborted).toBe(false);
      await act(async () => {
        view.rerender(<Harness request={request} replaceAdapter {...change} />);
      });
      expect(previews[0].signal.aborted).toBe(true);
      expect(previews).toHaveLength(1);
      expect(screen.queryByRole("region", { name: "Document packet" })).toBeNull();
    });
  }
});
