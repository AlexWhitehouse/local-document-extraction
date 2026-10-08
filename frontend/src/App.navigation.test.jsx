import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { session: null, signIn: vi.fn(), signOut: vi.fn() };

const createAuthClient = () => ({
  useSession: () => ({ data: auth.session, isPending: false, refetch: vi.fn() }),
  signIn: { email: auth.signIn },
  signUp: { email: vi.fn() },
  signOut: auth.signOut,
});

const toast = { error: vi.fn(), success: vi.fn() };

import { App } from "./App.jsx";

const account = { user: { id: "user", name: "Reader", email: "reader@example.test" }, session: { id: "session" } };

const fields = [{ id: "total", name: "Total", description: "Invoice total", data_type: "string" }];

const templates = ["one", "two"].map((id) => ({
  id,
  name: `Template ${id}`,
  description: "Invoice",
  fields,
  current_version: 1,
  tags: [],
}));

const documents = ["first", "second", "older"].map((id, index) => ({
  job_id: id,
  source_name: `${id}.pdf`,
  template_id: "one",
  status: "completed",
  current_attempt: 1,
  queued_at: `2026-01-0${3 - index}T00:00:00Z`,
  results: [{ field_id: "total", name: "Total", status: "found", answer: `Value ${id}` }],
}));

let removedTemplates, removedDocuments, delayDetail;

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  auth.session = account;
  removedTemplates = new Set();
  removedDocuments = new Set();
  delayDetail = null;
  localStorage.setItem(
    "documentextraction.workspace.v1",
    JSON.stringify({ workspaceId: "a", workspaceName: "Workspace a" }),
  );
  vi.stubGlobal("WebSocket", undefined);
  globalThis.fetch = vi.fn(async (input, options = {}) => {
    const path = new URL(String(input), window.location.origin).pathname;

    if (path === "/v1/workspaces")
      return response({ workspaces: ["a", "b"].map((id) => ({ id, name: `Workspace ${id}`, role: "owner" })) });

    if (path === "/v1/templates") return response({ templates: templates.filter((t) => !removedTemplates.has(t.id)) });

    if (path.startsWith("/v1/templates/")) {
      const id = path.split("/").at(-1);

      if (delayDetail) return delayDetail(id);
      const template = templates.find((t) => t.id === id && !removedTemplates.has(id));

      return template ? response(template) : response({ error: "not found" }, 404);
    }

    if (path === "/v1/jobs")
      return response({
        jobs: documents.slice(0, 2).filter((d) => !removedDocuments.has(d.job_id)),
        total: 3,
        has_more: true,
        next_cursor: "older",
      });

    if (path.startsWith("/v1/packets/")) return response({ error: "not found" }, 404);

    if (path.startsWith("/v1/jobs/")) {
      const id = path.split("/").at(-1);

      if (options.method === "DELETE") {
        removedDocuments.add(id);

        return response({ deleted: true, job_id: id });
      }

      const job = documents.find((d) => d.job_id === id && !removedDocuments.has(id));

      return job ? response(job) : response({ error: "not found" }, 404);
    }

    return response({ invitations: [], users: [], models: [], packets: [], tags: [] });
  });
});

function open(path) {
  window.history.replaceState(null, "", path);

  return render(<App createAuthClient={createAuthClient} notifications={toast} />);
}

const nav = (name) => within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name });

async function history(direction) {
  await act(async () => {
    window.history[direction]();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("stable app navigation", () => {
  it("restores a cross-Workspace document link beyond the first page, including refresh", async () => {
    const view = open("/workspaces/b/documents/older");
    expect(await screen.findByText("Value older")).toBeTruthy();

    const productCalls = globalThis.fetch.mock.calls.filter(
      ([path]) => String(path).includes("/jobs") || String(path).includes("/templates"),
    );

    expect(productCalls.length).toBeGreaterThan(0);
    expect(productCalls.every(([, options]) => new Headers(options.headers).get("x-workspace-id") === "b")).toBe(true);
    view.unmount();
    render(<App createAuthClient={createAuthClient} notifications={toast} />);
    expect(await screen.findByText("Value older")).toBeTruthy();
    expect(window.location.pathname).toBe("/workspaces/b/documents/older");
  });

  it("preserves the requested URL through sign-in", async () => {
    auth.session = null;
    const view = open("/workspaces/b/templates/two");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    auth.session = account;
    view.rerender(<App createAuthClient={createAuthClient} notifications={toast} />);
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template two"));
    expect(window.location.pathname).toBe("/workspaces/b/templates/two");
  });

  it("uses native resource links and restores selections with Back and Forward", async () => {
    const user = userEvent.setup();
    open("/workspaces/a/documents/first");
    await screen.findByText("Value first");
    const second = screen.getByRole("link", { name: /second.pdf/ });
    expect(second.getAttribute("href")).toBe("/workspaces/a/documents/second");
    await user.click(second);
    await screen.findByText("Value second");
    await history("back");
    await screen.findByText("Value first");
    await history("forward");
    await screen.findByText("Value second");
    await user.click(nav(/Templates/));
    await screen.findByLabelText("Template name");
    expect(window.location.pathname).toBe("/workspaces/a/templates/one");
    await history("back");
    await screen.findByText("Value second");
  });

  it("preserves a Template draft across sections and rejects destructive history traversal", async () => {
    const user = userEvent.setup();
    open("/workspaces/a/templates/one");
    await screen.findByLabelText("Template name");
    await user.click(screen.getByRole("link", { name: /Template two/ }));
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template two"));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Unsaved edit" } });
    await user.click(nav(/Documents/));
    await screen.findByText("Value first");
    await user.click(nav(/Templates/));
    expect(screen.getByLabelText("Template name").value).toBe("Unsaved edit");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await history("back");
    await history("back");
    await history("back");
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/a/templates/two"));
    expect(screen.getByLabelText("Template name").value).toBe("Unsaved edit");
    await history("back");
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template one"));
    await history("forward");
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template two"));
  });

  it("confirms a dirty Template before changing Workspace", async () => {
    const user = userEvent.setup();
    open("/workspaces/a/templates/one");
    await screen.findByLabelText("Template name");
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Unsaved" } });
    await user.click(nav(/Workspaces/));
    await user.click(screen.getByRole("link", { name: /Workspace b/ }));
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(window.location.pathname).toBe("/workspaces/a");
    await user.click(screen.getByRole("link", { name: /Workspace b/ }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/b"));
    await user.click(nav(/Templates/));
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template one"));
    await history("back");
    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/b"));
    await history("back");
    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/a"));
    await history("back");
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template one"));
  });

  it("preserves temporary Evaluation uploads between sections and confirms Workspace changes", async () => {
    const user = userEvent.setup();
    open("/workspaces/a/evaluations");
    const input = await screen.findByLabelText("Evaluation document");
    await user.upload(input, new File(["test"], "evaluation.pdf", { type: "application/pdf" }));
    await screen.findByText("evaluation.pdf");
    await user.click(nav(/Documents/));
    await screen.findByText("Value first");
    await history("back");
    expect(await screen.findByText("evaluation.pdf")).toBeTruthy();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(nav(/Workspaces/));
    await user.click(screen.getByRole("link", { name: /Workspace b/ }));
    expect(await screen.findByRole("alertdialog", { name: "Discard this evaluation?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep evaluation" }));
    expect(window.location.pathname).toBe("/workspaces/a");
    await user.click(screen.getByRole("link", { name: /Workspace b/ }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await screen.findByRole("heading", { name: "Workspace b", exact: true });
    await user.click(nav(/Evaluations/));
    await screen.findByLabelText("Evaluation document");
    expect(screen.queryByText("evaluation.pdf")).toBeNull();
  });

  it("does not warn when leaving Evaluations with only a non-draft popover open", async () => {
    const user = userEvent.setup();
    open("/workspaces/a/evaluations");
    await screen.findByLabelText("Evaluation document");
    const popover = document.createElement("div");
    popover.setAttribute("role", "dialog");
    document.body.append(popover);
    await user.click(nav(/Documents/));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/workspaces\/a\/documents/));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    popover.remove();
  });

  it("keeps a deleted Document URL on recovery and allows returning to the list", async () => {
    open("/workspaces/a/documents/first");
    await screen.findByText("Value first");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete document" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete document" }));
    await screen.findByText(/This document is unavailable/);
    expect(window.location.pathname).toBe("/workspaces/a/documents/first");
    await userEvent.click(screen.getByRole("button", { name: "Back to Documents" }));
    await screen.findByText("Value second");
    expect(window.location.pathname).toBe("/workspaces/a/documents/second");
  });

  it.each(["documents/gone", "templates/gone", "packets/gone"])(
    "shows recovery for a missing %s without opening a different resource",
    async (suffix) => {
      open(`/workspaces/a/${suffix}`);
      expect(await screen.findByText(/may have been deleted/)).toBeTruthy();
      expect(screen.queryByText("Value first")).toBeNull();
      expect(screen.queryByLabelText("Template name")).toBeNull();
      expect(window.location.pathname).toBe(`/workspaces/a/${suffix}`);
    },
  );

  it("keeps edits started before the Template list finishes loading", async () => {
    let resolve;
    const fetch = globalThis.fetch;
    globalThis.fetch = vi.fn((path, options) =>
      path === "/v1/templates"
        ? new Promise((done) => {
            resolve = done;
          })
        : fetch(path, options),
    );
    open("/workspaces/a/templates");
    await screen.findByLabelText("Template name");
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "New unsaved Template" } });
    await act(async () => resolve(response({ templates })));
    expect(screen.getByLabelText("Template name").value).toBe("New unsaved Template");
    expect(window.location.pathname).toBe("/workspaces/a/templates/new");
  });

  it("does not load product data for an inaccessible explicit Workspace", async () => {
    open("/workspaces/private/documents/secret");
    await screen.findByText(/workspace or invitation is unavailable/);
    expect(globalThis.fetch.mock.calls.some(([path]) => /\/v1\/(jobs|templates)/.test(path))).toBe(false);
    expect(window.location.pathname).toBe("/workspaces/private/documents/secret");
    expect(JSON.parse(localStorage.getItem("documentextraction.workspace.v1")).workspaceId).toBe("a");
    await userEvent.click(screen.getByRole("button", { name: "Back to Workspaces" }));
    await screen.findByRole("heading", { name: "Workspace details" });
    await waitFor(() => expect(window.location.pathname).toBe("/workspaces/a"));
  });

  it("sends the next account to / after sign out instead of the last account's Workspace", async () => {
    auth.signOut.mockImplementation(async () => {
      auth.session = null;
    });
    const view = open("/workspaces/b");
    await screen.findByRole("heading", { name: "Workspace details" });
    await userEvent.click(screen.getByRole("button", { name: /Reader/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(window.location.pathname).toBe("/");

    auth.session = { user: { id: "other", name: "Other", email: "other@example.test" }, session: { id: "next" } };
    view.rerender(<App createAuthClient={createAuthClient} notifications={toast} />);
    await screen.findByRole("heading", { name: "Workspace details" });
    expect(screen.queryByText(/workspace or invitation is unavailable/)).toBeNull();
  });

  it("retries Workspace loading without losing the requested resource URL", async () => {
    const fetch = globalThis.fetch;
    let failed = true;
    globalThis.fetch = vi.fn((path, options) =>
      failed && path === "/v1/workspaces" ? response({ error: "unavailable" }, 503) : fetch(path, options),
    );
    open("/workspaces/b/templates/two");
    await screen.findByText("Couldn't load workspace. Try again.");
    failed = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template two"));
    expect(window.location.pathname).toBe("/workspaces/b/templates/two");
  });

  it.each(["/unknown", "/workspaces/a/documents/x/extra", "/workspaces/%zz", "/workspaces/a/templates/one/versions/2"])(
    "handles invalid route %s",
    async (path) => {
      open(path);
      await screen.findByRole("heading", { name: "Page not found" });
      expect(screen.queryByLabelText("Template name")).toBeNull();
    },
  );

  it("does not display Admin content for an unauthorized account", async () => {
    open("/admin");
    await screen.findByRole("heading", { name: "Page unavailable" });
    expect(screen.getByText("This page is not available to your account.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Application admin" })).toBeNull();
  });

  it("discards a late template response after navigating to another template", async () => {
    let resolve;
    delayDetail = (id) =>
      id === "one"
        ? new Promise((done) => {
            resolve = done;
          })
        : response(templates[1]);
    open("/workspaces/a/templates/one");
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("link", { name: /Template two/ }));
    await waitFor(() => expect(screen.getByLabelText("Template name").value).toBe("Template two"));
    await act(async () => resolve(response(templates[0])));
    expect(screen.getByLabelText("Template name").value).toBe("Template two");
  });
});
