import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceDocumentProcessingSettings } from "./WorkspaceDocumentProcessingSettings.jsx";
import { useWorkspaceDocumentProcessingSettings } from "./useWorkspaceDocumentProcessingSettings.js";

const props = { workspaceId: "workspace_a", sessionUserId: "user_a", role: "owner", enabled: true };
const disabled = { enable_smart_splitting: false, exclude_blank_pages: false };

function fixture(settings = disabled) {
  let saved = settings;
  return vi.fn(async (_path, request) => {
    if (request.method === "PUT") saved = JSON.parse(request.body);
    return saved;
  });
}

describe("Workspace document processing settings", () => {
  it("enables blank removal only with splitting and preserves the saved preference when splitting is disabled", async () => {
    const coreRequest = fixture();
    function Harness() { return <WorkspaceDocumentProcessingSettings controller={useWorkspaceDocumentProcessingSettings({ ...props, coreRequest })} />; }
    render(<Harness />);
    const splitting = screen.getByLabelText("Enable smart splitting");
    const blank = screen.getByLabelText("Exclude blank pages");
    await waitFor(() => expect(splitting.disabled).toBe(false));
    expect(splitting.checked).toBe(false);
    expect(blank.disabled).toBe(true);
    fireEvent.click(splitting);
    await waitFor(() => expect(blank.disabled).toBe(false));
    fireEvent.click(blank);
    await waitFor(() => expect(blank.checked).toBe(true));
    fireEvent.click(splitting);
    await waitFor(() => expect(splitting.checked).toBe(false));
    expect(blank.checked).toBe(true);
    expect(blank.disabled).toBe(true);
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body)).toEqual({ enable_smart_splitting: false, exclude_blank_pages: true });
  });

  it("members see policy without write access", async () => {
    const coreRequest = fixture({ enable_smart_splitting: true, exclude_blank_pages: true });
    const { result } = renderHook(() => useWorkspaceDocumentProcessingSettings({ ...props, role: "member", coreRequest }));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    render(<WorkspaceDocumentProcessingSettings controller={result.current} />);
    expect(screen.getByLabelText("Enable smart splitting").disabled).toBe(true);
    expect(screen.getByLabelText("Exclude blank pages").disabled).toBe(true);
    await act(() => result.current.update("enable_smart_splitting", false));
    expect(coreRequest).toHaveBeenCalledTimes(1);
  });

  it("ignores a save response after switching Workspace and suppresses simultaneous writes", async () => {
    let completeSave;
    const coreRequest = vi.fn(async (_path, request) => request.method === "PUT" ? await new Promise((resolve) => { completeSave = resolve; }) : disabled);
    const { result, rerender } = renderHook((scope) => useWorkspaceDocumentProcessingSettings({ ...scope, coreRequest }), { initialProps: props });
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    let pending;
    act(() => { pending = result.current.update("enable_smart_splitting", true); });
    await act(() => result.current.update("exclude_blank_pages", true));
    expect(coreRequest.mock.calls.filter(([, request]) => request.method === "PUT")).toHaveLength(1);
    rerender({ ...props, workspaceId: "workspace_b" });
    await waitFor(() => expect(result.current.settings).toEqual(disabled));
    await act(async () => { completeSave({ enable_smart_splitting: true, exclude_blank_pages: false }); await pending; });
    expect(result.current.settings).toEqual(disabled);
  });

  it("keeps the prior policy after a failed save and permits a retry", async () => {
    const coreRequest = fixture();
    const { result } = renderHook(() => useWorkspaceDocumentProcessingSettings({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    coreRequest.mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.update("enable_smart_splitting", true));
    expect(result.current.error).toContain("could not be saved");
    expect(result.current.settings).toEqual(disabled);
    await act(() => result.current.update("enable_smart_splitting", true));
    expect(result.current.settings.enable_smart_splitting).toBe(true);
  });
});
