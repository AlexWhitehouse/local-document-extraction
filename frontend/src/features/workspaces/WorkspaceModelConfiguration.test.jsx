import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceModelConfiguration } from "./WorkspaceModelConfiguration.jsx";
import { useWorkspaceModelConfiguration } from "./useWorkspaceModelConfiguration.js";

const draft = {
  gateway_url: "http://localhost:1234/v1",
  model_name: "test/model",
  credential: "dummy-key",
  sequential_calls: false,
  supports_pdf_input: false,
  supports_structured_output: false,
};

const configured = { ...draft, credential: undefined, configured: true, credential_status: "configured", revision: 1 };

const response = (data) => ({
  data,
  headers: new Headers(data.configured ? { etag: `"workspace-model-${data.revision}"` } : {}),
});

const props = { workspaceId: "workspace_a", sessionUserId: "user_a", role: "owner", enabled: true };

const fill = (result, values = draft) =>
  act(() => {
    for (const [field, value] of Object.entries(values)) result.current.update(field, value);
  });

function apiFixture(initial = { configured: false }) {
  let saved = initial;

  const request = vi.fn(async (_path, options) => {
    if (options.method === "GET") return response(saved);

    if (options.method === "DELETE") {
      saved = { configured: false };

      return null;
    }

    if (_path.endsWith("/test")) return response({ status: "passed" });
    const { credential: _credential, ...fields } = JSON.parse(options.body);
    saved = { ...fields, configured: true, credential_status: "configured", revision: (saved.revision || 0) + 1 };

    return response(saved);
  });

  return request;
}

describe("Workspace Model gateway", () => {
  it.each(["missing", "weak"])(
    "can change the model with a %s response version header and still detects conflicts",
    async (headerMode) => {
      let saved = configured;

      const represent = () => ({
        data: saved,
        headers: new Headers(headerMode === "weak" ? { etag: `W/"workspace-model-${saved.revision}"` } : {}),
      });

      const coreRequest = vi.fn(async (_path, options) => {
        if (options.method === "GET") return represent();

        if (options.headers["if-match"] !== `"workspace-model-${saved.revision}"`) {
          throw Object.assign(new Error("precondition_failed"), { status: 412 });
        }

        if (_path.endsWith("/test")) return response({ status: "passed" });

        if (options.method === "DELETE") {
          saved = { configured: false };

          return null;
        }

        saved = { ...saved, ...JSON.parse(options.body), revision: saved.revision + 1 };

        return represent();
      });

      const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
      await waitFor(() => expect(result.current.ready).toBe(true));

      for (const model_name of ["changed/model", "reloaded/model"]) {
        await act(() => result.current.reload());
        fill(result, { model_name });
        await act(() => result.current.save());
        expect(result.current.error).toBe("");
        expect(result.current.conflict).toBe(false);
        expect(result.current.record.model_name).toBe(model_name);
      }

      // A save response must also supply the version for the next mutation.
      fill(result, { model_name: "saved-again/model" });
      await act(() => result.current.save());
      expect(result.current.record.model_name).toBe("saved-again/model");
      await act(() => result.current.testConnection());
      expect(result.current.testResult.passed).toBe(true);

      fill(result, { model_name: "unsaved/model" });
      await act(() => result.current.invalidate());
      expect(result.current.conflict).toBe(false);
      saved = { ...saved, revision: saved.revision + 1, model_name: "another-session/model" };
      await act(() => result.current.invalidate());
      expect(result.current.conflict).toBe(true);
      expect(result.current.draft.model_name).toBe("unsaved/model");
      await act(() => result.current.reload());
      expect(result.current.draft.model_name).toBe("another-session/model");

      // A change without a live notification must still be rejected on save.
      fill(result, { model_name: "stale-draft/model" });
      saved = { ...saved, revision: saved.revision + 1 };
      await act(() => result.current.save());
      expect(result.current.conflict).toBe(true);
      expect(saved.model_name).toBe("another-session/model");
      await act(() => result.current.reload());
      await act(() => result.current.clear());
      expect(result.current.record).toEqual({ configured: false });
    },
  );

  it("starts blank and saves, preserves, replaces, and clears using conditional write-only requests", async () => {
    const coreRequest = apiFixture();
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.record).toEqual({ configured: false }));
    expect(result.current.draft).toEqual({
      ...draft,
      gateway_url: "",
      model_name: "",
      credential: "",
      assistant_mode: "same",
      assistant_model_name: "",
      assistant_supports_pdf_input: false,
      assistant_supports_structured_output: false,
      classification_mode: "same",
      classification_model_name: "",
      classification_supports_pdf_input: false,
      classification_supports_structured_output: false,
    });
    expect(result.current.ready).toBe(false);
    fill(result);
    await act(() => result.current.save());
    expect(coreRequest.mock.calls.at(-1)[1].headers["if-none-match"]).toBe("*");
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body).assistant_model).toBeNull();
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
    expect(coreRequest.mock.calls.at(-1)[1]).toMatchObject({
      method: "DELETE",
      headers: { "if-match": '"workspace-model-3"' },
    });
    expect(result.current.record).toEqual({ configured: false });
    expect(result.current.draft.gateway_url).toBe("");
  });

  it("ties transient tests to the exact draft and ignores late responses after edits or Workspace changes", async () => {
    let resolveTest;
    const coreRequest = apiFixture(configured);
    const implementation = coreRequest.getMockImplementation();
    coreRequest.mockImplementation((path, options) =>
      path.endsWith("/test")
        ? new Promise((resolve) => {
            resolveTest = resolve;
          })
        : implementation(path, options),
    );

    const { result, rerender } = renderHook((scope) => useWorkspaceModelConfiguration({ ...scope, coreRequest }), {
      initialProps: props,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    let testing;
    act(() => {
      testing = result.current.testConnection();
    });
    expect(coreRequest.mock.calls.at(-1)[1].headers["if-match"]).toBe('"workspace-model-1"');
    fill(result, { model_name: "changed" });
    await act(async () => {
      resolveTest(response({ status: "passed" }));
      await testing;
    });
    expect(result.current.testResult).toBeNull();
    act(() => {
      testing = result.current.testConnection();
    });
    rerender({ ...props, workspaceId: "workspace_b" });
    await act(async () => {
      resolveTest(response({ status: "passed" }));
      await testing;
    });
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
    await waitFor(() => expect(result.current.error).toContain("Couldn't load the model gateway"));
    await act(() => result.current.reload());
    expect(result.current.ready).toBe(false);
    await act(() => result.current.save());
    expect(result.current.error).toContain("API key");
    fill(result, { gateway_url: "https://user:secret@example.com", credential: "repair" });
    await act(() => result.current.testConnection());
    expect(result.current.error).toContain("valid gateway URL");
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
    coreRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTest = resolve;
        }),
    );
    let testing;
    act(() => {
      testing = result.current.testConnection();
    });
    await act(() => result.current.invalidate());
    expect(result.current.conflict).toBe(false);
    expect(result.current.testing).toBe(true);
    await act(async () => {
      resolveTest(response({ status: "passed" }));
      await testing;
    });
    expect(result.current.testing).toBe(false);
    expect(result.current.testResult.passed).toBe(true);
  });

  it("revalidates invalidations received during a save after applying the mutation response", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { model_name: "my-change" });
    let resolveSave;
    coreRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    let saving;
    act(() => {
      saving = result.current.save();
    });
    await act(() => result.current.invalidate());
    expect(coreRequest).toHaveBeenCalledTimes(2);
    coreRequest.mockResolvedValueOnce(response({ ...configured, revision: 3, model_name: "later-change" }));
    await act(async () => {
      resolveSave(response({ ...configured, revision: 2, model_name: "my-change" }));
      await saving;
    });
    await waitFor(() => expect(result.current.draft.model_name).toBe("later-change"));
    expect(result.current.etag).toBe('"workspace-model-3"');
    expect(result.current.saving).toBe(false);
    expect(result.current.conflict).toBe(false);
  });

  it("starts on an empty summary and supports explicit editing, cancel, save, and clearing back to the summary", async () => {
    const coreRequest = apiFixture();
    const showActionToast = vi.fn();

    function Editor() {
      const controller = useWorkspaceModelConfiguration({ ...props, coreRequest, showActionToast });

      return <WorkspaceModelConfiguration controller={controller} />;
    }

    const { container } = render(<Editor />);
    await screen.findByText("Not configured");
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(
      within(screen.getByRole("table", { name: "Models" }))
        .getAllByRole("cell")
        .every((cell) => cell.textContent === "—"),
    ).toBe(true);
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByText("Same as extraction")).toBeNull();
    expect(screen.getByRole("button", { name: "Test connection" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: draft.gateway_url } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    expect(coreRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Gateway URL").value).toBe("");
    fireEvent.change(screen.getByLabelText("Gateway URL"), { target: { value: draft.gateway_url } });
    fireEvent.change(screen.getByLabelText("Extraction model"), { target: { value: draft.model_name } });
    fireEvent.change(screen.getByLabelText("Gateway API key"), { target: { value: draft.credential } });
    expect(screen.getByLabelText("Gateway API key").type).toBe("password");
    fireEvent.click(screen.getByRole("checkbox", { name: "Extraction: Direct PDF input" }));
    // An inherited assistant row mirrors the extraction capabilities and cannot be edited.
    expect(screen.getByRole("checkbox", { name: "Template assistant: Direct PDF input" }).checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Template assistant: Direct PDF input" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.modelGateway.save", "success"));
    expect(screen.queryByText(/Model gateway saved/)).toBeNull();
    expect(screen.queryByLabelText("Gateway API key")).toBeNull();
    expect(screen.getByText(draft.model_name)).toBeTruthy();
    expect(screen.getAllByText("Same as extraction")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Gateway API key").value).toBe("");
    fireEvent.change(screen.getByLabelText("Extraction model"), { target: { value: "discarded/model" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(draft.model_name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Extraction model").value).toBe(draft.model_name);
    fireEvent.click(screen.getByRole("button", { name: "Clear configuration" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Clear the Model gateway?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("Extraction model").value).toBe(draft.model_name);
    fireEvent.click(screen.getByRole("button", { name: "Clear configuration" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear gateway" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.modelGateway.clear", "success"));
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    expect(screen.getByRole("button", { name: "Test connection" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Gateway URL").value).toBe("");
  });

  it("keeps the gateway dialog open with the error inline when clearing fails, and does not toast", async () => {
    const baseRequest = apiFixture(configured);

    const coreRequest = vi.fn(async (path, options) => {
      if (options.method === "DELETE") throw Object.assign(new Error("boom"), { status: 500 });

      return baseRequest(path, options);
    });

    const showActionToast = vi.fn();

    function Editor() {
      const controller = useWorkspaceModelConfiguration({ ...props, coreRequest, showActionToast });

      return <WorkspaceModelConfiguration controller={controller} />;
    }

    render(<Editor />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear configuration" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear gateway" }));

    expect(await within(screen.getByRole("alertdialog")).findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(showActionToast).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Gateway URL")).toBeTruthy();
  });

  it("saves a different Template assistant model with its own capabilities and shows it in the summary", async () => {
    const coreRequest = apiFixture({ ...configured, supports_pdf_input: true });
    const showActionToast = vi.fn();

    function Editor() {
      const controller = useWorkspaceModelConfiguration({ ...props, coreRequest, showActionToast });

      return <WorkspaceModelConfiguration controller={controller} />;
    }

    render(<Editor />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Template assistant model source"), { target: { value: "custom" } });
    // A different model starts from the extraction model's capabilities.
    const assistantPdf = screen.getByRole("checkbox", { name: "Template assistant: Direct PDF input" });
    expect(assistantPdf.disabled).toBe(false);
    expect(assistantPdf.checked).toBe(true);
    // The browser's required check blocks submission until the assistant model is named.
    expect(screen.getByLabelText("Template assistant model").validity.valueMissing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(coreRequest.mock.calls.some(([, options]) => options.method === "PUT")).toBe(false);
    fireEvent.change(screen.getByLabelText("Template assistant model"), { target: { value: " assistant/model " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Template assistant: Structured output" }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledTimes(1));
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body).assistant_model).toEqual({
      model_name: "assistant/model",
      supports_pdf_input: true,
      supports_structured_output: true,
    });
    expect(screen.getByText("assistant/model")).toBeTruthy();
    expect(screen.getAllByText("Same as extraction")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Template assistant model").value).toBe("assistant/model");
    fireEvent.change(screen.getByLabelText("Template assistant model source"), { target: { value: "same" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledTimes(2));
    expect(showActionToast).toHaveBeenLastCalledWith("workspace.modelGateway.save", "success");
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body).assistant_model).toBeNull();
  });

  it("refuses a different assistant model without a name", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { assistant_mode: "custom", assistant_model_name: "  " });
    expect(await act(() => result.current.save())).toBe(false);
    expect(result.current.error).toContain("model names");
    expect(coreRequest).toHaveBeenCalledTimes(1);
  });

  it("reports which model failed a connection test and when both models passed", async () => {
    const coreRequest = apiFixture({
      ...configured,
      assistant_model: { model_name: "assistant/model", supports_pdf_input: false, supports_structured_output: false },
    });

    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.draft).toMatchObject({ assistant_mode: "custom", assistant_model_name: "assistant/model" });
    coreRequest.mockResolvedValueOnce(
      response({ status: "passed", tested_models: [{ model_role: "extraction" }, { model_role: "assistant" }] }),
    );
    await act(() => result.current.testConnection());
    expect(result.current.testResult).toMatchObject({ passed: true, message: expect.stringContaining("both models") });
    coreRequest.mockRejectedValueOnce(
      Object.assign(new Error("rejected"), { status: 422, details: { model_role: "assistant" } }),
    );
    await act(() => result.current.testConnection());
    expect(result.current.testResult).toMatchObject({
      passed: false,
      message: expect.stringContaining("Template assistant model"),
    });
  });

  it("shows ordinary members presence only and does not treat it as credential health", async () => {
    const coreRequest = apiFixture({ configured: true });
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, role: "member", coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    render(<WorkspaceModelConfiguration controller={result.current} />);
    expect(screen.getByText("Configured")).toBeTruthy();
    expect(screen.queryByLabelText("Gateway URL")).toBeNull();
    expect(screen.queryByText(/Credential unavailable/)).toBeNull();
    await act(() => result.current.save());
    expect(coreRequest).toHaveBeenCalledTimes(1);
  });
});

describe("Document classification & splitting model role", () => {
  it("can save a distinct model with its own capabilities and restore inheritance", async () => {
    const coreRequest = apiFixture(configured);

    function Harness() {
      const controller = useWorkspaceModelConfiguration({ ...props, coreRequest });

      return <WorkspaceModelConfiguration controller={controller} />;
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const source = screen.getByLabelText("Document classification & splitting model source");
    const pdf = screen.getByLabelText("Document classification & splitting: Direct PDF input");
    expect(source.value).toBe("same");
    expect(pdf.disabled).toBe(true);
    fireEvent.change(source, { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Document classification & splitting model"), {
      target: { value: "classify/model" },
    });
    fireEvent.click(pdf);
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() => expect(screen.getByText("classify/model")).toBeTruthy());
    expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body)).toMatchObject({
      model_name: "test/model",
      assistant_model: null,
      classification_model: {
        model_name: "classify/model",
        supports_pdf_input: true,
        supports_structured_output: false,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Document classification & splitting model source"), {
      target: { value: "same" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() => expect(JSON.parse(coreRequest.mock.calls.at(-1)[1].body).classification_model).toBeNull());
  });

  it("rejects missing custom names and names classification connection failures", async () => {
    const coreRequest = apiFixture(configured);
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    fill(result, { classification_mode: "custom", classification_model_name: " " });
    await act(() => result.current.save());
    expect(result.current.error).toContain("model names");
    expect(coreRequest).toHaveBeenCalledTimes(1);
    fill(result, { classification_model_name: "classify/model" });
    coreRequest.mockRejectedValueOnce(
      Object.assign(new Error("test failed"), { status: 422, details: { model_role: "classification" } }),
    );
    await act(() => result.current.testConnection());
    expect(result.current.testResult.message).toContain("Document classification & splitting model");
  });
});

describe("Changing only the extraction model", () => {
  const assistant_model = { model_name: "assistant/model", supports_pdf_input: true, supports_structured_output: false };

  it("keeps the gateway, API key and task models, and sends the saved version", async () => {
    const coreRequest = apiFixture({ ...configured, sequential_calls: true, assistant_model, classification_model: null });
    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    const next = { model_name: "best/model", supports_pdf_input: true, supports_structured_output: true };
    await act(() => result.current.setExtractionModel(next));

    const [path, options] = coreRequest.mock.calls.at(-1);
    expect(path).toBe("/workspaces/workspace_a/model-configuration");
    expect(options.method).toBe("PUT");
    expect(options.headers["if-match"]).toBe('"workspace-model-1"');
    expect(JSON.parse(options.body)).toEqual({
      gateway_url: draft.gateway_url,
      sequential_calls: true,
      assistant_model,
      classification_model: null,
      ...next,
    });
    expect(options.body).not.toContain("credential");
    expect(result.current.record).toMatchObject({ ...next, revision: 2 });
  });

  it("refuses for members and reloads after a stale version", async () => {
    const memberRequest = apiFixture({ configured: true });

    const member = renderHook(() =>
      useWorkspaceModelConfiguration({ ...props, role: "member", coreRequest: memberRequest }),
    );

    await waitFor(() => expect(member.result.current.ready).toBe(true));
    await expect(member.result.current.setExtractionModel({ model_name: "x" })).rejects.toThrow();

    let saved = configured;

    const coreRequest = vi.fn(async (_path, options) => {
      if (options.method === "GET") return response(saved);
      saved = { ...saved, revision: 5, model_name: "elsewhere/model" };
      throw Object.assign(new Error("precondition_failed"), { status: 412, code: "precondition_failed" });
    });

    const { result } = renderHook(() => useWorkspaceModelConfiguration({ ...props, coreRequest }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() =>
      expect(
        result.current.setExtractionModel({ model_name: "best/model", supports_pdf_input: false, supports_structured_output: false }),
      ).rejects.toMatchObject({ status: 412 }),
    );
    await waitFor(() => expect(result.current.record.model_name).toBe("elsewhere/model"));
    expect(result.current.saving).toBe(false);
    expect(result.current.conflict).toBe(false);
  });
});
