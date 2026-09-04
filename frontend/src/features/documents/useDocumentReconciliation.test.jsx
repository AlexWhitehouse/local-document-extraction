import React, { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentReconciliation } from "./useDocumentReconciliation";

function Harness({ workspaceId, requests, onModule }) {
  const { reconciliation, snapshot } = useDocumentReconciliation({
    sessionId: "session", workspaceId, enabled: true, requests,
  });
  onModule(reconciliation);
  return <div data-testid="documents">{snapshot.documents.map((job) => job.job_id).join(",")}</div>;
}

describe("Document reconciliation React adapter", () => {
  it("resubscribes after StrictMode cleanup and clears visible Documents on a Workspace change", async () => {
    let module;
    const onModule = (value) => { module = value; };
    const requests = { listDocuments: vi.fn(async () => ({ jobs: [{ job_id: "a", status: "processing" }] })) };
    const { rerender, unmount } = render(<StrictMode><Harness workspaceId="workspace-a" requests={requests} onModule={onModule} /></StrictMode>);
    await act(async () => { await module.refresh(); });
    expect(screen.getByTestId("documents").textContent).toBe("a");
    let finish;
    requests.listDocuments.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    let pending;
    act(() => { pending = module.refresh(); });
    rerender(<StrictMode><Harness workspaceId="workspace-b" requests={requests} onModule={onModule} /></StrictMode>);
    expect(screen.getByTestId("documents").textContent).toBe("");
    await act(async () => {
      finish({ jobs: [{ job_id: "old", status: "completed" }] });
      await pending;
    });
    expect(screen.getByTestId("documents").textContent).toBe("");
    act(() => { module.receiveLiveUpdates([{ job_id: "b", status: "queued" }]); });
    await waitFor(() => expect(screen.getByTestId("documents").textContent).toBe("b"));
    unmount();
  });
});
