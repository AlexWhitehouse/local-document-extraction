import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceModelConfiguration } from "./WorkspaceModelConfiguration.jsx";
import { useWorkspaceModelConfiguration } from "./useWorkspaceModelConfiguration.js";

const draft = { gateway_url: "http://localhost:1234/v1", model_name: "test/model", credential: "dummy-key", sequential_calls: false, supports_pdf_input: false, supports_structured_output: false };
const configured = { ...draft, credential: undefined, configured: true, credential_status: "configured", revision: 1 };
const response = (data) => ({ data, headers: new Headers(data.configured ? { etag: `"workspace-model-${data.revision}"` } : {}) });
const props = { workspaceId: "workspace_a", sessionUserId: "user_a", role: "owner", enabled: true };
const fill = (result, values = draft) => act(() => { for (const [field, value] of Object.entries(values)) result.current.update(field, value); });

function apiFixture(initial = { configured: false }) {
  let saved = initial;
  const request = vi.fn(async (_path, options) => {
    if (options.method === "GET") return response(saved);
    if (options.method === "DELETE") { saved = { configured: false }; return null; }
    if (_path.endsWith("/test")) return response({ status: "passed" });
    const { credential: _credential, ...fields } = JSON.parse(options.body);
    saved = { ...fields, configured: true, credential_status: "configured", revision: (saved.revision || 0) + 1 };
    return response(saved);
  });
  return request;
}

describe("Workspace Model gateway", () => {
  it("starts blank and saves, preserves, replaces, and clears using conditional write-only requests", async () => {
    const coreRequest = apiFixture();
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.record).toEqual({ configured: false }));
    expect(result.current.draft).toEqual({ ...draft, gateway_url: "", model_name: "", credential: "" });
    expect(result.current.ready).toBe(false);
    fill(result);
    await act(() => result.current.save());
    expect(coreRequest.mock.calls.at(-1)[1].headers["if-none-match"]).toBe("*");
    expect(coreRequest.mock.calls.some(([path]) => path.endsWith("/test"))).toBe(false);
    expect(result.current.draft.credential).toBe("");
    expect(result.current.ready).toBe(true);
    fill(result, { model_name: "changed/model" });
    await act(() => result.current.save());
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body)).not.toHaveProperty("credential");
    expect(coreRequest.mock.calls.at(-1)[1].headers["if-match"]).toBe('"workspace-model-1"');
    fill(result, { credential: "replacement" });
    await act(() => result.current.save());
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body).credential).toBe("replacement");
    expect(result.current.draft.credential).toBe("");
    await act(() => result.current.clear());
    expect(coreRequest.mock.calls.at(-1)[1]).toMatchObject({ method: "DELETE", headers: { "if-match": '"workspace-model-3"' } });
    expect(result.current.record).toEqual({ configured: false });
    expect(result.current.draft.gateway_url).toBe("");
  });

  it("ties transient tests to the exact draft and ignores late responses after edits or Workspace changes", async () => {
    let resolveTest;
    const coreRequest = apiFixture(configured);
    const implementation = coreRequest.getMockImplementation();
    coreRequest.mockImplementation((path, options) => path.endsWith("/test") ? new Promise((resolve) => { resolveTest = resolve; }) : implementation(path, options));
    const { result, rerender } = renderHook((scope) => useWorkspaceModelConfiguration({ ...scope, coreRequest }), { initialProps: props });
    await waitFor(() => expect(result.current.ready).toBe(true));
    let testing;
    act(() => { testing = result.current.testConnection(); });
    expect(coreRequest.mock.calls.at(-1)[1].headers["if-match"]).toBe('"workspace-model-1"');
    fill(result, { model_name: "changed" });
    await act(async () => { resolveTest(response({ status: "passed" })); await testing; });
    expect(result.current.testResult).toBeNull();
    act(() => { testing = result.current.testConnection(); });
    rerender({ ...props, workspaceId: "workspace_b" });
    await act(async () => { resolveTest(response({ status: "passed" })); await testing; });
    expect(result.current.testResult).toBeNull();
    fill(result, { credential: "never-retain" });
    rerender({ ...props, enabled: false, sessionUserId: "" });
    expect(result.current.record).toBeNull();
    expect(result.current.draft.credential).toBe("");
  });

  it("keeps failed tests independent of saves, detects stale revisions, and reloads explicitly", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    coreRequest.mockRejectedValueOnce(new Error("unavailable"));
    await act(() => result.current.testConnection());
    expect(result.current.testResult.passed).toBe(false);
    fill(result, { model_name: "new" });
    expect(result.current.testResult).toBeNull();
    coreRequest.mockRejectedValueOnce(Object.assign(new Error("stale"), { status: 412 }));
    await act(() => result.current.save());
    expect(result.current.conflict).toBe(true);
    expect(result.current.ready).toBe(false);
    await act(() => result.current.reload());
    expect(result.current.conflict).toBe(false);
    await act(() => result.current.testConnection());
    expect(result.current.testResult.passed).toBe(true);
    fill(result, { model_name: "new" });
    await act(() => result.current.save());
    expect(result.current.record.model_name).toBe("new");
  });

  it("reloads invalidations without exposing an old draft as a current revision", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { model_name: "unsaved" });
    coreRequest.mockResolvedValueOnce(response({ ...configured, revision: 2 }));
    await act(() => result.current.invalidate());
    expect(result.current.conflict).toBe(true);
    expect(result.current.draft.model_name).toBe("unsaved");
    await act(() => result.current.reload());
    await act(() => result.current.invalidate());
    expect(result.current.conflict).toBe(false);
    expect(result.current.draft.model_name).toBe("test/model");
  });

  it("supports load retry and requires a replacement for unreadable credentials", async () => {
    const coreRequest = apiFixture({ ...configured, credential_status: "unavailable" });
    coreRequest.mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.error).toContain("could not be loaded"));
    await act(() => result.current.reload());
    expect(result.current.ready).toBe(false);
    await act(() => result.current.save());
    expect(result.current.error).toContain("new credential");
    fill(result, { gateway_url: "https://user:secret@example.com", credential: "repair" });
    await act(() => result.current.testConnection());
    expect(result.current.error).toContain("valid HTTP(S)");
    fill(result, { gateway_url: draft.gateway_url });
    await act(() => result.current.save());
    expect(result.current.ready).toBe(true);
  });

  it("keeps a running draft test valid when reconnect returns the same configuration", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { model_name: "unsaved" });
    let resolveTest;
    coreRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveTest = resolve; }));
    let testing;
    act(() => { testing = result.current.testConnection(); });
    await act(() => result.current.invalidate());
    expect(result.current.conflict).toBe(false);
    expect(result.current.testing).toBe(true);
    await act(async () => { resolveTest(response({ status: "passed" })); await testing; });
    expect(result.current.testing).toBe(false);
    expect(result.current.testResult.passed).toBe(true);
  });

  it("revalidates invalidations received during a save after applying the mutation response", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { model_name: "my-change" });
    let resolveSave;
    coreRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    let saving;
    act(() => { saving = result.current.save(); });
    await act(() => result.current.invalidate());
    expect(coreRequest).toHaveBeenCalledTimes(2);
    coreRequest.mockResolvedValueOnce(response({ ...configured, revision: 3, model_name: "later-change" }));
    await act(async () => { resolveSave(response({ ...configured, revision: 2, model_name: "my-change" })); await saving; });
    await waitFor(() => expect(result.current.draft.model_name).toBe("later-change"));
    expect(result.current.etag).toBe('"workspace-model-3"');
    expect(result.current.saving).toBe(false);
    expect(result.current.conflict).toBe(false);
  });

  it("shows the approved expandable editor, write-only input, capability declarations, and clear confirmation", async () => {
    const coreRequest = apiFixture();
    function Editor() {
      const controller = useWorkspaceModelConfiguration({ ...props, coreRequest });
      return <WorkspaceModelConfiguration controller={controller} />;
    }
    const { container } = render(<Editor />);
    await screen.findByText("Not configured");
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: draft.gateway_url } });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: draft.model_name } });
    fireEvent.change(screen.getByLabelText("Gateway API key"), { target: { value: draft.credential } });
    expect(screen.getByLabelText("Gateway API key").type).toBe("password");
    fireEvent.click(screen.getByText("Capabilities & call behavior"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Direct PDF input/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText("Model gateway saved.");
    expect(screen.getByLabelText("Gateway API key").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Clear configuration" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    await screen.findByText("Model gateway cleared.");
  });

  it("shows ordinary members presence only and does not treat it as credential health", async () => {
    const coreRequest = apiFixture({ configured: true });
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, role: "member", coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    render(<WorkspaceModelConfiguration controller={result.current} />);
    expect(screen.getByText("Configured")).toBeTruthy();
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
    expect(screen.queryByText(/Credential unavailable/)).toBeNull();
    await act(() => result.current.save());
    expect(coreRequest).toHaveBeenCalledTimes(1);
  });
});
