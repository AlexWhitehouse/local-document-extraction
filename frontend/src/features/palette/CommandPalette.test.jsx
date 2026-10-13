import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { appPath } from "../../lib/appRoutes";
import { CLOSE_FALLBACK_MS, CommandPalette } from "./CommandPalette.jsx";
import { NO_MODEL_MESSAGE } from "./paletteState.js";
import { SEARCH_LIMITS } from "../../../../shared/documentSearch.ts";

const catalog = {
  templates: [
    {
      id: "invoice",
      name: "Invoice",
      current_version: 3,
      fields: [
        { field_id: "invoice_number", name: "Invoice number", data_type: "string", type: "text" },
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
      ],
    },
    {
      id: "receipt",
      name: "Receipt",
      current_version: 1,
      fields: [{ field_id: "total", name: "Total", data_type: "number", type: "number" }],
    },
  ],
  models: [],
  interpretation: { available: true },
};

const HNH = 'Find all documents where the invoice number starts with "hnh"';

const TOTAL = "Find documents where total is over 500";

const jobs = [
  {
    job_id: "job-1",
    source_name: "hnh-inv-20517.pdf",
    template_id: "invoice",
    template_name: "Invoice",
    status: "completed",
    created_at: "2026-10-12T09:00:00Z",
    matches: [
      { template_id: "invoice", field_id: "invoice_number", field_name: "Invoice number", type: "text", value_state: "value", display: "HNH-20517" },
    ],
  },
  {
    job_id: "job-2",
    source_name: "hnh-inv-20431.pdf",
    template_id: "invoice",
    template_name: "Invoice",
    status: "failed",
    created_at: "2026-10-08T09:00:00Z",
    matches: [
      { template_id: "invoice", field_id: "invoice_number", field_name: "Invoice number", type: "text", value_state: "value", display: "HNH-20431" },
    ],
  },
];

function deferred() {
  let resolve, reject;

  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// A workspace-scoped request seam: each route answers from the test's handlers.
function createRequest(handlers = {}) {
  return vi.fn(async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;

    if (path.startsWith("/jobs?search=")) return handlers.documentMatches ? handlers.documentMatches(path) : { jobs: [] };

    if (path === "/search/interpret") {
      if (handlers.interpret) return handlers.interpret(body);
      throw Object.assign(new Error("No model"), { status: 409, code: "workspace_model_not_configured" });
    }

    if (path === "/jobs/search") {
      if (handlers.search) return handlers.search(body);

      if (body.ids_only)
        return {
          job_ids: jobs.map((job) => job.job_id),
          statuses: Object.fromEntries(jobs.map((job) => [job.job_id, job.status])),
          total: jobs.length,
          total_capped: false,
          has_more: false,
          next_cursor: null,
        };

      return { jobs, total: jobs.length, total_capped: false, next_cursor: null, has_more: false };
    }

    if (path.startsWith("/jobs/") && options.method === "DELETE") {
      if (handlers.remove) return handlers.remove(path.split("/").at(-1));

      return { deleted: true, job_id: path.split("/").at(-1) };
    }

    if (path === "/jobs/retry") return { retried: body.job_ids, skipped: [] };

    throw Object.assign(new Error("Not found"), { status: 404 });
  });
}

function createContext(overrides = {}) {
  return {
    workspaceId: "w1",
    workspaceName: "Operations",
    role: "owner",
    workspaces: [
      { id: "w1", name: "Operations" },
      { id: "w2", name: "Demo" },
    ],
    request: createRequest(),
    notify: vi.fn(),
    navigate: vi.fn(),
    appPath,
    catalog,
    catalogStatus: "ready",
    refreshCatalog: vi.fn(async () => catalog),
    today: "2026-10-13",
    templateController: { templates: catalog.templates },
    documentController: {
      statusCounts: { queued: 0, processing: 0, completed: 1, failed: 1 },
      toolbar: { documentCount: 2 },
      contextList: {
        documents: jobs,
        onFiltersChange: vi.fn(),
        onRetryDocumentList: vi.fn(),
      },
    },
    workspaceController: {},
    evaluation: {},
    modelReady: true,
    ...overrides,
  };
}

// Hosts the palette the way App does: a closing palette stays mounted until its out animation
// ends, and each opening is a new palette.
function Harness({ context, flows, label = "Open palette", initiallyOpen = false }) {
  const [palette, setPalette] = useState({ status: initiallyOpen ? "open" : "closed", key: 0 });

  return (
    <>
      <button type="button" onClick={() => setPalette((current) => ({ status: "open", key: current.key + 1 }))}>
        {label}
      </button>
      {palette.status !== "closed" ? (
        <CommandPalette
          key={palette.key}
          context={context}
          flows={flows}
          closing={palette.status === "closing"}
          onRequestClose={() => setPalette((current) => ({ ...current, status: "closing" }))}
          onClose={() => setPalette((current) => ({ ...current, status: "closed" }))}
        />
      ) : null}
    </>
  );
}

const paletteClosed = () =>
  waitFor(() => expect(screen.queryByRole("dialog", { name: "Search and actions" })).toBeNull());

async function openPalette(context, user) {
  render(<Harness context={context} />);
  await user.click(screen.getByRole("button", { name: "Open palette" }));

  return screen.getByRole("dialog", { name: "Search and actions" });
}

const input = () => screen.getByRole("combobox", { name: "Search or ask" });

const pills = () => screen.getByRole("combobox", { name: "Your request" });

describe("CommandPalette", () => {
  let user;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("traps focus, steps back once per Esc and restores focus when it closes", async () => {
    const context = createContext();
    const dialog = await openPalette(context, user);
    expect(document.activeElement).toBe(input());

    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    // Flow → list.
    await user.type(input(), "export");
    await user.click(screen.getByRole("option", { name: /Export documents…/ }));
    expect(await screen.findByRole("region", { name: "Export" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Export" })).toBeNull();
    expect(document.activeElement).toBe(input());

    // Pills → text → empty → closed.
    await user.clear(input());
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await screen.findByRole("combobox", { name: "Your request" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(input().value).toBe(HNH);
    await user.keyboard("{Escape}");
    expect(input().value).toBe("");
    await user.keyboard("{Escape}");
    await paletteClosed();
    // Focus returns in the effect cleanup that runs just after the palette leaves the page.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open palette" })));
  });

  it("shows local matches as you type without waiting for the network", async () => {
    const pending = deferred();
    const context = createContext({ request: createRequest({ documentMatches: () => pending.promise }) });
    await openPalette(context, user);

    // With nothing typed: suggested actions, recent documents and example questions.
    expect(screen.getByRole("group", { name: "Actions" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Recent documents" })).getByText("hnh-inv-20517.pdf")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Try asking" })).toBeTruthy();

    await user.type(input(), "invo");
    expect(within(screen.getByRole("group", { name: "Templates" })).getByRole("option", { name: /Invoice/ })).toBeTruthy();

    await user.clear(input());
    await user.type(input(), "cost");
    expect(within(screen.getByRole("group", { name: "Go to" })).getByRole("option", { name: /Costs/ })).toBeTruthy();

    await user.clear(input());
    await user.type(input(), "demo");
    expect(within(screen.getByRole("group", { name: "Workspaces" })).getByRole("option", { name: /Demo/ })).toBeTruthy();

    // Arrow keys move the active option; Enter runs it.
    expect(input().getAttribute("aria-activedescendant")).toBeTruthy();
    await user.keyboard("{Home}{Enter}");
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/w2");
  });

  it("debounces document name matches into the Documents group", async () => {
    const context = createContext({ request: createRequest({ documentMatches: () => ({ jobs: [jobs[0]] }) }) });
    await openPalette(context, user);
    await user.type(input(), "20517");

    const group = await screen.findByRole("group", { name: "Documents" });
    expect(within(group).getByText("hnh-inv-20517.pdf")).toBeTruthy();
    expect(context.request).toHaveBeenCalledWith("/jobs?search=20517", expect.objectContaining({ method: "GET" }));
  });

  it("renders pills on Enter at once, then what each matched after interpretation", async () => {
    const interpretation = deferred();
    const searches = [];

    const request = createRequest({
      interpret: () => interpretation.promise,
      search: (body) => {
        searches.push(body);

        return body.ids_only
          ? { job_ids: [], statuses: {}, total: 0, total_capped: false, has_more: false }
          : { jobs: [], total: 0, total_capped: false, next_cursor: null, has_more: false };
      },
    });

    const context = createContext({ request });
    await openPalette(context, user);
    await user.type(input(), TOTAL);
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    const box = pills();
    expect(box.getAttribute("aria-busy")).toBe("true");
    expect(within(box).getByText("total").closest(".palette-pill").className).toContain("is-pending");
    expect(within(box).queryByText("Invoice")).toBeNull();
    expect(request).toHaveBeenCalledWith("/search/interpret", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse(request.mock.calls.find(([path]) => path === "/search/interpret")[1].body);
    expect(sent).toMatchObject({ text: TOTAL, today: "2026-10-13" });
    expect(sent.segments.map((segment) => segment.type)).toContain("field");
    expect(sent.time_zone).toBeTruthy();

    await act(async () =>
      interpretation.resolve({
        interpretation: {
          action: "find_documents",
          args: {},
          filter: { conditions: [{ template_id: "invoice", field_id: "total", op: "gt", value: 500 }] },
          unrecognised: [],
          notes: [
            {
              kind: "ambiguous_field",
              text: "“Total” is on Invoice and Receipt. Using Invoice.",
              alternatives: [{ template_id: "receipt", field_id: "total" }],
            },
          ],
        },
      }),
    );

    await waitFor(() => expect(within(pills()).getByText("Invoice")).toBeTruthy());
    expect(pills().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("“Total” is on Invoice and Receipt. Using Invoice.")).toBeTruthy();
    await waitFor(() => expect(searches.some((body) => !body.ids_only)).toBe(true));

    // One click swaps the ambiguous field for the alternative and searches again.
    await user.click(screen.getByRole("button", { name: "Use Receipt" }));
    await waitFor(() =>
      expect(searches.at(-1).filter.conditions[0]).toEqual({ template_id: "receipt", field_id: "total", op: "gt", value: 500 }),
    );
    expect(within(pills()).getByText("Receipt")).toBeTruthy();

    // The legend names the pill types; typing again returns to editable text.
    expect(within(screen.getByLabelText("Pill types")).getByText("Field")).toBeTruthy();
    pills().focus();
    await user.keyboard("x");
    expect(input().value).toBe(`${TOTAL}x`);
  });

  it("keeps the local pills and shows a message when interpretation fails", async () => {
    const request = createRequest({
      interpret: () => {
        throw Object.assign(new Error("Gateway"), { status: 502, code: "search_interpretation_failed" });
      },
    });

    const context = createContext({ request });
    await openPalette(context, user);
    await user.type(input(), "Find documents billed to Leeds");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(await screen.findByText("Couldn't interpret the whole request")).toBeTruthy();
    expect(within(pills()).getByText("Find")).toBeTruthy();
    expect(within(pills()).getByText("billed").closest(".palette-pill").className).toContain("palette-pill-unused");
    expect(context.notify).not.toHaveBeenCalled();
  });

  it("explains why Ask is unavailable without a model, and still reads requests locally", async () => {
    const context = createContext({
      catalog: { ...catalog, interpretation: { available: false, reason: "model_not_configured" } },
    });

    await openPalette(context, user);
    await user.type(input(), "Find documents billed to Leeds");

    const ask = screen.getByRole("option", { name: new RegExp(NO_MODEL_MESSAGE) });
    expect(ask.getAttribute("aria-disabled")).toBe("true");

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(await screen.findByText(/Some words weren't used/)).toBeTruthy();
    expect(context.request).not.toHaveBeenCalledWith("/search/interpret", expect.anything());
  });

  it("shows results with highlighted values and the bulk actions that apply", async () => {
    const context = createContext();
    await openPalette(context, user);
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(await screen.findByText("hnh-inv-20517.pdf")).toBeTruthy();
    expect(within(document.querySelector(".palette-summary")).getByText("2 documents")).toBeTruthy();
    expect(screen.getByText(/Invoice › Invoice number starts with “hnh”/)).toBeTruthy();
    expect(screen.getAllByText("HNH").every((mark) => mark.tagName === "MARK")).toBe(true);
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(within(pills()).getByText("2 found")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Export 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try 1 failed again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeTruthy();

    // Open goes to the document and closes the palette.
    await user.keyboard("{Enter}");
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/w1/documents/job-1");
    await paletteClosed();
  });

  it("searches by processing cost when the catalogue allows it, and shows each document's cost", async () => {
    const costCatalog = { ...catalog, capabilities: { cost: true } };
    const searches = [];

    const request = createRequest({
      search: (body) => {
        searches.push(body);

        if (body.ids_only) return { job_ids: ["job-1"], statuses: { "job-1": "completed" }, total: 1, total_capped: false, has_more: false, next_cursor: null };

        return {
          jobs: [{ ...jobs[0], matches: [{ kind: "cost", amount: 0.0312, currency: "USD", complete: true, display: "$0.0312" }] }],
          total: 1,
          total_capped: false,
          next_cursor: null,
          has_more: false,
        };
      },
    });

    const context = createContext({ catalog: costCatalog, refreshCatalog: vi.fn(async () => costCatalog), request });
    await openPalette(context, user);
    await user.type(input(), "Show me documents with a cost greater than $0.03");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(await screen.findByText("hnh-inv-20517.pdf")).toBeTruthy();
    expect(screen.getByText(/Cost \$0\.0312/)).toBeTruthy();
    expect(screen.getByText(/cost over \$0\.03/)).toBeTruthy();
    expect(within(pills()).getByText("Processing cost")).toBeTruthy();
    // Read locally, so no model call; the search carries the cost.
    expect(context.request).not.toHaveBeenCalledWith("/search/interpret", expect.anything());
    expect(searches[0].filter).toEqual({ cost: { op: "gt", value: 0.03 } });
  });

  it("stops a delete at a confirmation inside the palette, with Cancel focused", async () => {
    const context = createContext();
    await openPalette(context, user);
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.click(await screen.findByRole("button", { name: "Delete…" }));

    expect(await screen.findByRole("heading", { name: "Delete 2 documents?" })).toBeTruthy();
    expect(screen.getByText(/This can't be undone\./)).toBeTruthy();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(context.request).not.toHaveBeenCalledWith(expect.stringMatching(/^\/jobs\/job-/), expect.anything());

    await user.click(screen.getByRole("button", { name: "Delete 2 documents" }));
    await waitFor(() => expect(context.notify).toHaveBeenCalledWith("document.bulkDelete", "success", { removed: 2 }));
    expect(context.request).toHaveBeenCalledWith("/jobs/job-1", { method: "DELETE" });
    await paletteClosed();
  });

  it("opens the Documents list with the request's dates and leaves out search text the list can't show", async () => {
    const searches = [];

    const request = createRequest({
      interpret: () => ({
        interpretation: {
          action: "find_documents",
          args: {},
          filter: { text: "hnh", uploaded_from: "2026-10-01" },
          unrecognised: [],
          notes: [],
        },
      }),
      search: (body) => {
        searches.push(body);

        return body.ids_only
          ? { job_ids: ["job-1"], statuses: { "job-1": "completed" }, total: 1, total_capped: false, has_more: false }
          : { jobs: [jobs[0]], total: 1, total_capped: false, next_cursor: null, has_more: false };
      },
    });

    const context = createContext({ request });
    await openPalette(context, user);
    await user.type(input(), "Find hnh documents uploaded since 2026-10-01");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.click(await screen.findByRole("button", { name: "Open in Documents" }));

    expect(searches[0].filter).toMatchObject({ text: "hnh", uploaded_from: "2026-10-01" });
    expect(context.documentController.contextList.onFiltersChange).toHaveBeenCalledWith({
      dateFrom: "2026-10-01",
      dateTo: "",
      model: "",
    });
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/w1/documents");
    await paletteClosed();
  });

  it("goes to a page straight away from a sentence", async () => {
    const context = createContext();
    await openPalette(context, user);
    await user.type(input(), "Go to costs");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/w1/costs");
  });

  it("searches again when documents change while results are open", async () => {
    const context = createContext();
    const view = render(<CommandPalette context={context} onClose={() => {}} />);
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await screen.findByText("hnh-inv-20517.pdf");
    const before = context.request.mock.calls.filter(([path]) => path === "/jobs/search").length;

    const changed = {
      ...context,
      documentController: { ...context.documentController, statusCounts: { completed: 2, failed: 0 } },
    };

    view.rerender(<CommandPalette context={changed} onClose={() => {}} />);
    await waitFor(() =>
      expect(context.request.mock.calls.filter(([path]) => path === "/jobs/search").length).toBeGreaterThan(before),
    );
  });
});

// Answers ids_only searches with `ids` (the newest matches) and pages with every job.
function searchWith(ids, { total = ids.length, statuses } = {}) {
  const bodies = [];

  return {
    bodies,
    search: (body) => {
      bodies.push(body);

      if (body.ids_only)
        return {
          job_ids: ids.slice(0, body.limit),
          statuses: statuses || Object.fromEntries(jobs.map((job) => [job.job_id, job.status])),
          total,
          total_capped: false,
          has_more: total > Math.min(ids.length, body.limit),
          next_cursor: null,
        };

      return { jobs: jobs.slice(0, body.limit), total, total_capped: false, next_cursor: null, has_more: false };
    },
  };
}

describe("CommandPalette bulk actions", () => {
  let user;

  beforeEach(() => {
    user = userEvent.setup();
  });

  async function ask(context, sentence) {
    await openPalette(context, user);
    await user.type(input(), sentence);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
  }

  it("keeps “the latest N” when deleting, and names only what is deleted", async () => {
    const answers = searchWith(["job-1"], { total: 47 });
    const context = createContext({ request: createRequest({ search: answers.search }) });
    await ask(context, "Delete the latest 1 failed documents");

    expect(await screen.findByRole("heading", { name: 'Delete "hnh-inv-20517.pdf"?' })).toBeTruthy();
    expect(answers.bodies.find((body) => body.ids_only).limit).toBe(1);
    expect(screen.queryByText("hnh-inv-20431.pdf", { exact: false })).toBeNull();
    expect(screen.queryByText(/newest/)).toBeNull();
  });

  it("notes the bulk cap only when it applies", async () => {
    const answers = searchWith(["job-1", "job-2"], { total: 900 });
    const context = createContext({ request: createRequest({ search: answers.search }) });
    await ask(context, "Delete failed documents");

    expect(await screen.findByText(/The newest 2 of 900 are deleted\./)).toBeTruthy();
    expect(answers.bodies.find((body) => body.ids_only).limit).toBe(SEARCH_LIMITS.idsPageSize);
  });

  it("exports at most the latest N", async () => {
    const answers = searchWith(["job-1", "job-2"]);
    const context = createContext({ request: createRequest({ search: answers.search }) });
    await ask(context, "Export the latest 1 documents");

    expect(await screen.findByRole("heading", { name: "Export 1 document" })).toBeTruthy();
    expect(answers.bodies.find((body) => body.ids_only).limit).toBe(1);
  });

  it("tries again only the failed documents among the results", async () => {
    const context = createContext();
    await ask(context, HNH);
    await user.click(await screen.findByRole("button", { name: "Try 1 failed again" }));

    const list = await screen.findByRole("group", { name: "Failed documents" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(list).getByText("hnh-inv-20431.pdf")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again on 1 document" }));
    await waitFor(() => expect(context.notify).toHaveBeenCalledWith("document.retry", "success", { retried: 1, skipped: 0 }));
    const sent = context.request.mock.calls.find(([path]) => path === "/jobs/retry")[1];
    expect(JSON.parse(sent.body)).toEqual({ job_ids: ["job-2"] });
  });

  it("holds the palette open while a delete runs, and reports documents already gone", async () => {
    const pending = deferred();
    const request = createRequest({ remove: (id) => (id === "job-1" ? pending.promise : Promise.reject(Object.assign(new Error("Gone"), { status: 404 }))) });
    const context = createContext({ request });
    await ask(context, HNH);
    await user.click(await screen.findByRole("button", { name: "Delete…" }));
    await user.click(await screen.findByRole("button", { name: "Delete 2 documents" }));

    const dialog = screen.getByRole("dialog", { name: "Search and actions" });
    expect(dialog.getAttribute("data-command-palette-busy")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Delete 2 documents?" })).toBeTruthy();

    await act(async () => pending.resolve({ deleted: true, job_id: "job-1" }));
    await waitFor(() => expect(context.notify).toHaveBeenCalledWith("document.bulkDelete", "success", { removed: 1 }));
    await paletteClosed();
  });
});

describe("CommandPalette focus and lifecycle", () => {
  let user;

  beforeEach(() => {
    user = userEvent.setup();
  });

  // A two-step flow whose step change unmounts the focused button.
  function StepFlow({ onFinish, registerBack }) {
    const [step, setStep] = useState(1);
    finishers.push(onFinish);
    registerBack(null);

    return step === 1 ? (
      <button type="button" onClick={() => setStep(2)}>
        Next step
      </button>
    ) : (
      <p>Second step</p>
    );
  }

  const finishers = [];
  const testFlows = { upload: { title: "Upload documents", Component: StepFlow } };

  it("keeps focus in the flow when a step change removes the focused control, so Esc still steps back", async () => {
    render(<CommandPalette context={createContext()} onClose={() => {}} flows={testFlows} />);
    await user.type(input(), "upload");
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Next step" }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "Upload documents" })));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Second step")).toBeNull();
    expect(input()).toBeTruthy();
  });

  it("steps back on Esc even after a click moves focus to the dialog itself", async () => {
    const context = createContext();
    await openPalette(context, user);
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await screen.findByText("hnh-inv-20517.pdf");

    screen.getByRole("dialog", { name: "Search and actions" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();
    expect(input().value).toBe(HNH);
  });

  it("ignores a finish from a flow of a palette that has since closed", async () => {
    finishers.length = 0;

    render(<Harness context={createContext()} flows={testFlows} label="Reopen" initiallyOpen />);
    await user.type(input(), "upload");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Next step" });
    const late = finishers.at(-1);

    await user.keyboard("{Escape}{Escape}{Escape}");
    await paletteClosed();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    act(() => late());
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();
  });

  it("limits the request to the interpretation length", async () => {
    render(<CommandPalette context={createContext()} onClose={() => {}} />);
    expect(input().getAttribute("maxlength")).toBe(String(SEARCH_LIMITS.interpretationTextCharacters));
  });

  it("drops a page of an earlier search when Load more answers late", async () => {
    const late = deferred();
    const searches = [];

    const request = createRequest({
      search: (body) => {
        searches.push(body);

        if (body.cursor) return late.promise;

        if (body.ids_only) return { job_ids: ["job-1"], statuses: { "job-1": "completed" }, total: 1, total_capped: false, has_more: false };

        return { jobs: [jobs[0]], total: 2, total_capped: false, next_cursor: "page-2", has_more: true };
      },
    });

    render(<CommandPalette context={createContext({ request })} onClose={() => {}} />);
    await user.type(input(), HNH);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.click(await screen.findByRole("button", { name: "Load more" }));

    // A new request replaces the results before the old page arrives.
    pills().focus();
    await user.keyboard("{Backspace}");
    await user.clear(input());
    await user.type(input(), "Find failed documents");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(searches.at(-1).filter).toEqual({ statuses: ["failed"] }));

    await act(async () =>
      late.resolve({ jobs: [jobs[1]], total: 2, total_capped: false, next_cursor: null, has_more: false }),
    );

    await screen.findByText("hnh-inv-20517.pdf");
    expect(screen.queryByText("hnh-inv-20431.pdf")).toBeNull();
  });
});

describe("CommandPalette closing", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Search and actions" });

  // jsdom has no AnimationEvent, so the event carries its animationName by hand.
  function endAnimation(element, animationName = "modal-card-out") {
    const event = new Event("animationend", { bubbles: true });
    Object.defineProperty(event, "animationName", { value: animationName });
    fireEvent(element, event);
  }

  function renderClosing(context = createContext()) {
    const onRequestClose = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette context={context} onRequestClose={onRequestClose} onClose={onClose} />);

    return { onRequestClose, onClose };
  }

  it("fades out first and calls onClose when the animation ends", () => {
    const { onRequestClose, onClose } = renderClosing();
    fireEvent.keyDown(input(), { key: "Escape" });

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(dialog().classList.contains("is-closing")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Neither a child's animation (a pill appearing) nor the entrance counts.
    endAnimation(input());
    endAnimation(dialog(), "modal-card-in");
    expect(onClose).not.toHaveBeenCalled();
    endAnimation(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes when no animationend arrives", () => {
    vi.useFakeTimers();
    const { onClose } = renderClosing();
    fireEvent.keyDown(input(), { key: "Escape" });

    act(() => vi.advanceTimersByTime(CLOSE_FALLBACK_MS - 1));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    // The animation ending late doesn't close twice.
    endAnimation(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes at once with reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

    const { onClose } = renderClosing();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("animates out when the app asks it to close", () => {
    const context = createContext();
    const onClose = vi.fn();
    const view = render(<CommandPalette context={context} onClose={onClose} />);
    view.rerender(<CommandPalette context={context} closing onClose={onClose} />);

    expect(dialog().classList.contains("is-closing")).toBe(true);
    endAnimation(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores typing, Enter and the backdrop while it fades out", () => {
    const context = createContext();
    const { onRequestClose } = renderClosing(context);
    fireEvent.change(input(), { target: { value: "Go to costs" } });
    fireEvent.click(screen.getByRole("option", { name: /Costs/ }));

    expect(context.navigate).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    fireEvent.change(input(), { target: { value: "Go to templates" } });
    expect(input().value).toBe("Go to costs");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.pointerDown(document.querySelector(".modal-backdrop"));
    fireEvent.pointerUp(document.querySelector(".modal-backdrop"));

    expect(context.navigate).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("drops a request still waiting for the catalogue when the palette closes", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const context = createContext({ catalog: null, catalogStatus: "loading", refreshCatalog: vi.fn(() => pending.promise) });
    await openPalette(context, user);
    await user.type(input(), "Go to costs");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(context.refreshCatalog).toHaveBeenCalled();

    await user.keyboard("{Escape}{Escape}");
    await paletteClosed();
    await act(async () => pending.resolve(catalog));

    expect(context.navigate).not.toHaveBeenCalled();
  });

  it("drops a request still waiting for the catalogue when the palette unmounts", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const context = createContext({ catalog: null, catalogStatus: "loading", refreshCatalog: vi.fn(() => pending.promise) });
    const view = render(<CommandPalette context={context} onClose={() => {}} />);
    await user.type(input(), "Go to costs");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    view.unmount();
    await act(async () => pending.resolve(catalog));

    expect(context.navigate).not.toHaveBeenCalled();
  });
});

describe("CommandPalette review regressions", () => {
  let user;

  beforeEach(() => {
    user = userEvent.setup();
  });

  const manyJobs = Array.from({ length: 130 }, (_, index) => ({
    ...jobs[0],
    job_id: `job-${index + 1}`,
    source_name: `doc-${index + 1}.pdf`,
  }));

  it("pages “the latest N” within the search page size and stops loading more at N", async () => {
    const bodies = [];

    const request = createRequest({
      search: (body) => {
        bodies.push(body);

        if (body.ids_only)
          return {
            job_ids: manyJobs.slice(0, body.limit).map((job) => job.job_id),
            statuses: {},
            total: manyJobs.length,
            total_capped: false,
            has_more: true,
            next_cursor: null,
          };

        // The search route takes at most SEARCH_LIMITS.pageSize rows unless ids_only is set.
        if (body.limit > SEARCH_LIMITS.pageSize) throw Object.assign(new Error("limit too large"), { status: 400 });
        const start = Number(body.cursor || 0);
        const end = start + body.limit;

        return {
          jobs: manyJobs.slice(start, end),
          total: manyJobs.length,
          total_capped: false,
          next_cursor: end < manyJobs.length ? String(end) : null,
          has_more: end < manyJobs.length,
        };
      },
    });

    const context = createContext({ request });
    await openPalette(context, user);
    await user.type(input(), "Find the latest 120 documents");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(await screen.findByText("doc-50.pdf")).toBeTruthy();
    expect(screen.queryByText("doc-51.pdf")).toBeNull();
    expect(bodies.find((body) => body.ids_only).limit).toBe(120);

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("doc-100.pdf")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("doc-120.pdf")).toBeTruthy();

    expect(screen.queryByText("doc-121.pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(bodies.flatMap((body) => (body.ids_only ? [] : [body.limit]))).toEqual([50, 50, 20]);
  });

  async function openInDocuments(filter) {
    const request = createRequest({
      interpret: () => ({ interpretation: { action: "find_documents", args: {}, filter, unrecognised: [], notes: [] } }),
    });

    const context = createContext({ request });
    await openPalette(context, user);
    // Unknown words, so the model reads the request.
    await user.type(input(), "Find the paperwork from the usual supplier");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.click(await screen.findByRole("button", { name: "Open in Documents" }));

    return context;
  }

  it("carries the dates of a request over to the Documents list, even with criteria the list can't show", async () => {
    const context = await openInDocuments({
      statuses: ["failed"],
      uploaded_from: "2026-10-01",
      uploaded_to: "2026-10-10",
    });

    expect(context.documentController.contextList.onFiltersChange).toHaveBeenCalledWith({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-10",
      model: "",
    });
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/w1/documents");
  });

  it("clears earlier list filters when nothing in the request carries over", async () => {
    const context = await openInDocuments({ statuses: ["failed"], text: "hnh" });

    expect(context.documentController.contextList.onFiltersChange).toHaveBeenCalledWith({ dateFrom: "", dateTo: "", model: "" });
  });
});

describe("CommandPalette in the app", () => {
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const createAuthClient = () => ({
    useSession: () => ({
      data: { user: { id: "user", name: "Reader", email: "reader@example.test" }, session: { id: "session" } },
      isPending: false,
      refetch: vi.fn(),
    }),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  });

  beforeEach(() => {
    localStorage.setItem("documentextraction.workspace.v1", JSON.stringify({ workspaceId: "a", workspaceName: "Workspace a" }));
    vi.stubGlobal("WebSocket", undefined);
    globalThis.fetch = vi.fn(async (input) => {
      const path = new URL(String(input), window.location.origin).pathname;

      if (path === "/v1/workspaces")
        return response({
          workspaces: [
            { id: "a", name: "Workspace a", role: "owner" },
            { id: "b", name: "Workspace b", role: "owner" },
          ],
        });

      if (path === "/v1/search/catalog") return response(catalog);

      if (path === "/v1/templates") return response({ templates: [] });

      if (path === "/v1/jobs") return response({ jobs: [], total: 0, has_more: false, next_cursor: null });

      return response({ invitations: [], users: [], models: [], packets: [], tags: [] });
    });
  });

  it("opens from the sidebar Search button and with ⌘K or Ctrl+K, even from a field", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/workspaces/a/documents");
    render(<App createAuthClient={createAuthClient} notifications={{ error: vi.fn(), success: vi.fn() }} />);

    const search = await screen.findByRole("button", { name: "Search" });
    await waitFor(() => expect(search.disabled).toBe(false));
    await user.click(search);
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();
    await waitFor(() =>
      expect(globalThis.fetch.mock.calls.some(([path]) => String(path).includes("/v1/search/catalog"))).toBe(true),
    );

    await user.keyboard("{Escape}");
    await paletteClosed();
    await waitFor(() => expect(document.activeElement).toBe(search));

    // A field on the page: the shortcut works while typing.
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement, { key: "k", metaKey: true });
    await paletteClosed();
    field.remove();
  });

  async function openApp() {
    window.history.replaceState(null, "", "/workspaces/a/documents");
    render(<App createAuthClient={createAuthClient} notifications={{ error: vi.fn(), success: vi.fn() }} />);
    const search = await screen.findByRole("button", { name: "Search" });
    await waitFor(() => expect(search.disabled).toBe(false));

    return search;
  }

  it("closes when the workspace changes, so nothing acts on the previous workspace", async () => {
    const user = userEvent.setup();
    await user.click(await openApp());
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();

    await act(async () => {
      window.history.pushState(null, "", "/workspaces/b/documents");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search and actions" })).toBeNull());
  });

  it("fades out with the workspace it was opened in when the workspace changes", async () => {
    const user = userEvent.setup();
    await user.click(await openApp());
    await user.type(input(), "Workspace a");

    act(() => {
      window.history.pushState(null, "", "/workspaces/b/documents");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    const dialog = screen.getByRole("dialog", { name: "Search and actions" });
    expect(dialog.classList.contains("is-closing")).toBe(true);
    expect(within(dialog).getByRole("option", { name: /Workspace a.*Current workspace/ })).toBeTruthy();
    await paletteClosed();
  });

  it("reopens fresh when ⌘K is pressed while it fades out", async () => {
    const user = userEvent.setup();
    const search = await openApp();
    await user.click(search);
    await user.type(input(), "export");

    fireEvent.keyDown(document.activeElement, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Search and actions" }).classList.contains("is-closing")).toBe(true);
    fireEvent.keyDown(document.activeElement, { key: "k", metaKey: true });

    const dialog = screen.getByRole("dialog", { name: "Search and actions" });
    expect(dialog.classList.contains("is-closing")).toBe(false);
    expect(input().value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(input()));

    // The earlier palette's close finishing doesn't take the new one with it.
    await new Promise((resolve) => setTimeout(resolve, CLOSE_FALLBACK_MS + 50));
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBe(dialog);

    await user.keyboard("{Escape}");
    await paletteClosed();
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("doesn't open over another dialog such as the onboarding tour", async () => {
    await openApp();
    const tour = document.createElement("section");
    tour.setAttribute("role", "dialog");
    document.body.append(tour);

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search and actions" })).toBeNull();
    tour.remove();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search and actions" })).toBeTruthy();
  });
});
