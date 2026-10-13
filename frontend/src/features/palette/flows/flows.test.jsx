import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appPath } from "../../../lib/appRoutes.js";
import { EditTemplateFlow } from "./EditTemplateFlow.jsx";
import { CreateTemplateFlow } from "./CreateTemplateFlow.jsx";
import { UploadFlow } from "./UploadFlow.jsx";
import { InviteFlow } from "./InviteFlow.jsx";
import { SwitchWorkspaceFlow } from "./SwitchWorkspaceFlow.jsx";
import { EvaluationFlow } from "./EvaluationFlow.jsx";

afterEach(cleanup);

const catalog = {
  templates: [
    {
      id: "tpl",
      name: "Invoice",
      current_version: 3,
      fields: [
        { field_id: "billing_address", name: "Billing address", data_type: "string", type: "text" },
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
      ],
    },
    { id: "receipt", name: "Receipt", current_version: 1, fields: [] },
  ],
  models: ["model-a", "model-b"],
  interpretation: { available: true },
};

const savedInvoice = {
  id: "tpl",
  name: "Invoice",
  description: "Supplier invoices",
  current_version: 3,
  tags: ["finance"],
  fields: [
    { name: "Billing address", description: "Full billing address", data_type: "string" },
    { name: "Total", description: "Amount due", data_type: "number" },
  ],
};

const addVat = {
  id: "vat",
  title: "Add VAT number",
  rationale: "Invoices show the supplier VAT number.",
  dependsOn: [],
  operations: [
    {
      op: "add_field",
      after: 1,
      field: { name: "VAT number", description: "Supplier VAT number", data_type: "string" },
    },
  ],
};

const renameTotal = {
  id: "rename",
  title: "Rename Total",
  rationale: "Matches the wording on the invoice.",
  dependsOn: ["vat"],
  operations: [{ op: "update_field", fieldIndex: 1, expectName: "Total", set: { name: "Amount due" } }],
};

const assistAnswer = (options, groups) => ({
  base: JSON.parse(options.body.get("payload")).base,
  explanation: "Invoices carry a VAT number that isn't extracted yet.",
  observations: [],
  groups,
});

function makeContext(overrides = {}) {
  return {
    workspaceId: "ws",
    workspaceName: "Operations",
    role: "owner",
    workspaces: [
      { id: "ws", name: "Operations" },
      { id: "ws2", name: "Finance" },
    ],
    request: vi.fn(),
    notify: vi.fn(),
    navigate: vi.fn(() => true),
    appPath,
    catalog,
    refreshCatalog: vi.fn(),
    today: "2026-10-13",
    templateController: {
      templates: [
        { id: "tpl", name: "Invoice", tags: ["finance"] },
        { id: "receipt", name: "Receipt", tags: [] },
      ],
      actions: { listTemplates: vi.fn(), prepareDraft: vi.fn() },
      toolbar: { selectedTemplateId: "" },
      navigation: { hasUnsavedChanges: false, retry: vi.fn() },
    },
    documentController: {
      uploadModal: { maxSourceFileBytes: 10 * 1024 * 1024 },
      actions: { uploadEntries: vi.fn() },
    },
    workspaceController: { acceptedPage: { onRetryWorkspaceInvitations: vi.fn() } },
    evaluation: { state: { candidates: [], setup: null, error: "" }, api: vi.fn(), start: vi.fn() },
    modelReady: true,
    ...overrides,
  };
}

const flowProps = (context, interpretation = null) => ({
  interpretation,
  targets: null,
  context,
  onFinish: vi.fn(),
  onBack: vi.fn(),
  registerBack: vi.fn(),
});

const editRequest = ({ groups = [addVat, renameTotal], assist, patch } = {}) =>
  vi.fn(async (path, options = {}) => {
    if (path === "/templates/tpl" && options.method === "GET") return structuredClone(savedInvoice);

    if (path === "/templates/assist/suggestions")
      return { suggestions: [{ label: "Add a VAT number", request: "Add a VAT number field", reason: "Common on invoices." }] };

    if (path === "/templates/assist") return assist ? assist(options) : assistAnswer(options, groups);

    if (path === "/templates/tpl" && options.method === "PATCH") return patch ? patch(options) : { template_id: "tpl" };

    throw new Error(`Unexpected ${path}`);
  });

async function reachProposal(props) {
  render(<EditTemplateFlow {...props} />);
  const picker = screen.getByRole("combobox", { name: "Which template?" });
  fireEvent.change(picker, { target: { value: "inv" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(picker, { key: "Enter" });
  const chip = await screen.findByRole("button", { name: "Add a VAT number" });
  fireEvent.click(chip);
  expect(screen.getByLabelText("What should change?").value).toBe("Add a VAT number field");
  fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));
  await screen.findByRole("heading", { name: "Proposed changes" });
}

describe("edit template flow", () => {
  it("chooses a template, proposes changes and saves the selected groups as the next version", async () => {
    const request = editRequest();
    const context = makeContext({ request });
    const props = flowProps(context);
    await reachProposal(props);

    const sent = JSON.parse(request.mock.calls.find(([path]) => path === "/templates/assist")[1].body.get("payload"));
    expect(sent).toMatchObject({ action: "edit", instructions: "Add a VAT number field", base: { templateId: "tpl" } });
    expect(sent.draft.fields.map((field) => field.name)).toEqual(["Billing address", "Total"]);
    expect(screen.getByText("Changes output keys")).toBeTruthy();

    // Dependencies follow the checkboxes in both directions.
    const vat = screen.getByRole("checkbox", { name: /Add VAT number/ });
    const rename = screen.getByRole("checkbox", { name: /Rename Total/ });
    fireEvent.click(vat);
    expect(rename.checked).toBe(false);
    fireEvent.click(rename);
    expect(vat.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save 2 changes as v4" }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalled());
    const [, patch] = request.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(JSON.parse(patch.body)).toEqual({
      fields: [
        { name: "Billing address", description: "Full billing address", data_type: "string" },
        { name: "Amount due", description: "Amount due", data_type: "number" },
        { name: "VAT number", description: "Supplier VAT number", data_type: "string" },
      ],
    });
    expect(context.notify).toHaveBeenCalledWith("template.save", "success", { targetName: "Invoice" });
    expect(context.templateController.actions.listTemplates).toHaveBeenCalled();
    expect(context.refreshCatalog).toHaveBeenCalled();
  });

  it("opens the selected changes in the editor as a draft", async () => {
    const context = makeContext({ request: editRequest() });
    const props = flowProps(context);
    await reachProposal(props);
    fireEvent.click(screen.getByRole("checkbox", { name: /Rename Total/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(context.templateController.actions.prepareDraft).toHaveBeenCalledWith({
      templateId: "tpl",
      draft: expect.objectContaining({
        name: "Invoice",
        fields: [
          expect.objectContaining({ name: "Billing address" }),
          expect.objectContaining({ name: "Total" }),
          expect.objectContaining({ id: "vat_number", name: "VAT number" }),
        ],
      }),
    });
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/ws/templates/tpl");
    expect(props.onFinish).toHaveBeenCalled();
    expect(context.notify).not.toHaveBeenCalled();
  });

  it("keeps request and save failures inline without a toast, and steps back inside the flow", async () => {
    let failSave = false;

    const request = editRequest({
      assist: () => Promise.reject(Object.assign(new Error("gateway"), { status: 502 })),
    });

    const context = makeContext({ request });
    const props = flowProps(context, { action: "edit_template", args: { template_id: "tpl", instruction: "Add VAT" } });
    render(<EditTemplateFlow {...props} />);
    const propose = await screen.findByRole("button", { name: "Propose changes" });
    await waitFor(() => expect(propose.disabled).toBe(false));
    fireEvent.click(propose);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't get a proposal. Try again.");
    expect(context.notify).not.toHaveBeenCalled();

    request.mockImplementation(async (path, options = {}) => {
      if (path === "/templates/assist") return assistAnswer(options, [addVat]);

      if (options.method === "PATCH") {
        if (failSave) throw Object.assign(new Error("conflict"), { status: 409 });
      }

      return path === "/templates/tpl" ? structuredClone(savedInvoice) : { suggestions: [] };
    });
    failSave = true;
    fireEvent.click(screen.getByRole("button", { name: "Propose changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 change as v4" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This changed since you opened it. Reload and try again.");
    expect(context.notify).not.toHaveBeenCalled();
    expect(props.onFinish).not.toHaveBeenCalled();

    const back = props.registerBack.mock.calls.findLast(([handler]) => handler)[0];
    let handled;
    act(() => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(screen.getByLabelText("What should change?")).toBeTruthy();
    act(() => {
      handled = back();
    });
    expect(handled).toBe(false);
  });
});

describe("create template flow", () => {
  const proposal = (options) => ({
    ...assistAnswer(options, [
      {
        id: "name",
        title: "Name the template",
        rationale: "Describes the document.",
        dependsOn: [],
        operations: [{ op: "set_template", set: { name: "Delivery note", description: "Delivery notes" } }],
      },
      {
        id: "fields",
        title: "Add fields",
        rationale: "The details you asked for.",
        dependsOn: [],
        operations: [
          { op: "add_field", after: null, field: { name: "Delivery date", description: "Date delivered", data_type: "date" } },
          { op: "add_field", after: null, field: { name: "Driver name", description: "Driver", data_type: "string" } },
          { op: "add_field", after: null, field: { name: "Signed", description: "Signature present", data_type: "boolean" } },
        ],
      },
    ]),
  });

  it("drafts fields over an empty draft and creates the template with the chosen fields", async () => {
    const request = vi.fn(async (path, options) =>
      path === "/templates/assist" ? proposal(options) : { template_id: "new_tpl", name: "Delivery note" },
    );

    const context = makeContext({ request });
    const props = flowProps(context, { action: "create_template", args: { instruction: "delivery notes" } });
    render(<CreateTemplateFlow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose fields" }));
    await screen.findByRole("heading", { name: "New template" });

    const sent = JSON.parse(request.mock.calls[0][1].body.get("payload"));
    expect(sent.draft).toEqual({ name: "", description: "", fields: [] });
    expect(sent.base.templateId).toBe("");
    expect(screen.getByLabelText("Name").value).toBe("Delivery note");
    expect(screen.getByText("Yes / No")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Driver name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalled());

    const [, create] = request.mock.calls.find(([path]) => path === "/templates");
    expect(create.method).toBe("POST");
    expect(JSON.parse(create.body)).toEqual({
      name: "Delivery note",
      description: "Delivery notes",
      tags: [],
      fields: [
        { name: "Delivery date", description: "Date delivered", data_type: "date" },
        { name: "Signed", description: "Signature present", data_type: "boolean" },
      ],
    });
    const [key, outcome, options] = context.notify.mock.calls[0];
    expect([key, outcome, options.targetName]).toEqual(["template.create", "success", "Delivery note"]);
    options.link.onClick();
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/ws/templates/new_tpl");
  });

  it("validates the name and keeps a failed create inline", async () => {
    const request = vi.fn(async (path, options) => {
      if (path === "/templates/assist") return proposal(options);
      throw Object.assign(new Error("denied"), { status: 403 });
    });

    const context = makeContext({ request });
    const props = flowProps(context, { action: "create_template", args: { instruction: "delivery notes" } });
    render(<CreateTemplateFlow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose fields" }));
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    expect(await screen.findByText("Enter a template name.")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.change(name, { target: { value: "Delivery note" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You don't have permission to do that.");
    expect(context.notify).not.toHaveBeenCalled();
    expect(props.onFinish).not.toHaveBeenCalled();
  });
});

describe("upload flow", () => {
  const pdf = (name) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

  it("validates picked files, lets you remove one and uploads the rest with the chosen template", async () => {
    const context = makeContext();
    context.documentController.actions.uploadEntries.mockResolvedValue({ queued: 1, failed: 0 });
    const props = flowProps(context);
    render(<UploadFlow {...props} />);
    const template = screen.getByLabelText("Template");
    expect(template.value).toBe("automatic");
    expect(screen.getByText("Each document is matched to one of the 1 tagged template.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Files"), {
      target: { files: [pdf("a.pdf"), pdf("b.pdf"), new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert").textContent).toBe("notes.txt isn't a PDF, PNG, JPG or WEBP file");
    fireEvent.click(screen.getByRole("button", { name: "Remove b.pdf" }));
    fireEvent.change(template, { target: { value: "tpl" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 document" }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalled());

    const [{ entries, templateId, templateTags }] = context.documentController.actions.uploadEntries.mock.calls[0];
    expect(entries.map((entry) => entry.file.name)).toEqual(["a.pdf"]);
    expect([templateId, templateTags]).toEqual(["tpl", undefined]);
  });

  it("keeps failed files listed with their reason and needs a model", async () => {
    const context = makeContext();

    context.documentController.actions.uploadEntries.mockImplementation(async ({ entries, onProgress }) => {
      onProgress(entries[0].id, "failed", "This is too large to upload.");

      return { queued: 0, failed: 1 };
    });

    const props = flowProps(context);
    const { rerender } = render(<UploadFlow {...props} />);
    fireEvent.change(screen.getByLabelText("Files"), { target: { files: [pdf("a.pdf")] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 document" }));
    expect(await screen.findByText("This is too large to upload.")).toBeTruthy();
    expect(context.documentController.actions.uploadEntries.mock.calls[0][0].templateTags).toEqual(["finance"]);
    expect(props.onFinish).not.toHaveBeenCalled();
    rerender(<UploadFlow {...props} context={{ ...context, modelReady: false }} />);
    expect(screen.getByText(/Uploads need a Model gateway/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
  });
});

describe("invite flow", () => {
  it("validates the email inline, then sends the invitation with the chosen role", async () => {
    const context = makeContext();
    context.request.mockResolvedValue({ id: "invitation" });
    const props = flowProps(context, { action: "invite", args: { email: "sam@", role: "admin" } });
    render(<InviteFlow {...props} />);
    expect(screen.getByRole("radio", { name: "Admin" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeTruthy();
    expect(context.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(props.onFinish).toHaveBeenCalled());
    expect(context.request).toHaveBeenCalledWith("/workspaces/ws/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sam@example.com", role: "admin" }),
    });
    expect(context.notify).toHaveBeenCalledWith("workspaceInvitation.create", "success", { targetEmail: "sam@example.com" });
    expect(context.workspaceController.acceptedPage.onRetryWorkspaceInvitations).toHaveBeenCalled();
  });

  it("shows failures inline and explains when the role can't invite", async () => {
    const context = makeContext();
    context.request.mockRejectedValue(Object.assign(new Error("nope"), { status: 403 }));
    const props = flowProps(context, { action: "invite", args: { email: "sam@example.com" } });
    const { rerender } = render(<InviteFlow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You don't have permission to do that.");
    expect(context.notify).not.toHaveBeenCalled();
    rerender(<InviteFlow {...props} context={{ ...context, role: "member" }} />);
    expect(screen.getByText(/Only workspace owners and admins can invite members/)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

describe("switch workspace flow", () => {
  it("marks the current workspace and switches with the keyboard", () => {
    const context = makeContext();
    const props = flowProps(context);
    render(<SwitchWorkspaceFlow {...props} />);
    const list = screen.getByRole("listbox", { name: "Switch workspace" });
    expect(within(list).getByText("Current")).toBeTruthy();
    const input = screen.getByRole("combobox", { name: "Switch workspace" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(list).getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/ws2");
    expect(props.onFinish).toHaveBeenCalled();
  });
});

describe("evaluation flow", () => {
  it("opens the Evaluations page and sets up one candidate per chosen model", async () => {
    const context = makeContext();

    context.evaluation.api.mockResolvedValue({
      json: async () => ({ ...savedInvoice, current_version: 3 }),
    });

    const props = flowProps(context, { action: "run_evaluation", args: { template_id: "tpl" } });
    const { rerender } = render(<EvaluationFlow {...props} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "model-b" }));
    fireEvent.click(screen.getByRole("button", { name: "Set up evaluation" }));
    expect(context.navigate).toHaveBeenCalledWith("/workspaces/ws/evaluations");
    expect(screen.getByRole("status").textContent).toContain("Setting up the evaluation…");

    const loaded = { ...context, evaluation: { ...context.evaluation, state: { candidates: [], setup: { configured: true, model: "model-a" } } } };
    rerender(<EvaluationFlow {...props} context={loaded} />);
    await waitFor(() => expect(props.onFinish).toHaveBeenCalled());
    expect(context.evaluation.api).toHaveBeenCalledWith("/evaluations/templates/tpl");
    const [mode, entries] = context.evaluation.start.mock.calls[0];
    expect(mode).toBe("models");
    expect(entries.map((entry) => entry.model)).toEqual(["model-a", "model-b"]);
    expect(entries[0].template.source).toEqual({ id: "tpl", version: 3 });
    expect(context.notify).toHaveBeenCalledWith("evaluation.setUp", "success", { targetName: "Invoice" });
  });

  it("explains a missing Model gateway inline", async () => {
    const context = makeContext();
    const props = flowProps(context);
    const { rerender } = render(<EvaluationFlow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up evaluation" }));
    const unconfigured = { ...context, evaluation: { ...context.evaluation, state: { candidates: [], setup: { configured: false } } } };
    rerender(<EvaluationFlow {...props} context={unconfigured} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Evaluations need a Model gateway");
    expect(context.evaluation.start).not.toHaveBeenCalled();
    expect(context.notify).not.toHaveBeenCalled();
  });
});

const latestBack = (props) => props.registerBack.mock.calls.findLast(([handler]) => handler)[0];

const deferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
};

describe("catalogue arriving after the flow opens", () => {
  it("picks the upload template once the catalogue loads and explains the wait", () => {
    const context = makeContext({ catalog: null });
    context.templateController.templates = [{ id: "tpl", name: "Invoice", tags: [] }];
    const props = flowProps(context);
    const { rerender } = render(<UploadFlow {...props} />);
    fireEvent.change(screen.getByLabelText("Files"), {
      target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByText("Loading templates…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload 1 document" }).disabled).toBe(true);
    rerender(<UploadFlow {...props} context={{ ...context, catalog }} />);
    expect(screen.getByLabelText("Template").value).toBe("tpl");
    expect(screen.getByRole("button", { name: "Upload 1 document" }).disabled).toBe(false);
  });

  it("picks the evaluation template once the catalogue loads", () => {
    const context = makeContext({ catalog: null });
    const props = flowProps(context);
    const { rerender } = render(<EvaluationFlow {...props} />);
    rerender(<EvaluationFlow {...props} context={{ ...context, catalog }} />);
    expect(screen.getByLabelText("Template").value).toBe("tpl");
    expect(screen.getByRole("checkbox", { name: "model-a" }).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Set up evaluation" }).disabled).toBe(false);
  });
});

describe("interrupted uploads", () => {
  it("says the upload stopped rather than blaming another upload", async () => {
    const context = makeContext();
    context.documentController.actions.uploadEntries.mockResolvedValue({ interrupted: true });
    const props = flowProps(context);
    render(<UploadFlow {...props} />);
    fireEvent.change(screen.getByLabelText("Files"), {
      target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 document" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The upload stopped before it finished. Check the documents list before trying again.",
    );
    expect(props.onFinish).not.toHaveBeenCalled();
  });
});

describe("pending actions", () => {
  it("keeps Esc inside the flow while saving a template, and never finishes after unmount", async () => {
    const pending = deferred();
    const context = makeContext({ request: editRequest({ groups: [addVat], patch: () => pending.promise }) });
    const props = flowProps(context, { action: "edit_template", args: { template_id: "tpl", instruction: "Add VAT" } });
    const { unmount } = render(<EditTemplateFlow {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 change as v4" }));
    expect(latestBack(props)()).toBe(true);
    expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(true);
    unmount();
    await act(async () => pending.resolve({ template_id: "tpl" }));
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it("keeps Esc inside the flow while creating a template", async () => {
    const pending = deferred();

    const request = vi.fn(async (path, options) =>
      path === "/templates/assist"
        ? assistAnswer(options, [
            {
              id: "fields",
              title: "Add fields",
              rationale: "Requested.",
              dependsOn: [],
              operations: [{ op: "add_field", after: null, field: { name: "Date", description: "Date", data_type: "date" } }],
            },
          ])
        : pending.promise,
    );

    const context = makeContext({ request });
    const props = flowProps(context, { action: "create_template", args: { instruction: "notes" } });
    const { unmount } = render(<CreateTemplateFlow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose fields" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Creating…" })).toBeTruthy());
    expect(latestBack(props)()).toBe(true);
    unmount();
    await act(async () => pending.resolve({ template_id: "notes" }));
    expect(props.onFinish).not.toHaveBeenCalled();
  });

  it("keeps Esc inside the flow while uploading and inviting", async () => {
    const upload = deferred();
    const context = makeContext();
    context.documentController.actions.uploadEntries.mockReturnValue(upload.promise);
    const uploadProps = flowProps(context);
    const uploadView = render(<UploadFlow {...uploadProps} />);
    expect(latestBack(uploadProps)()).toBe(false);
    fireEvent.change(screen.getByLabelText("Files"), {
      target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 document" }));
    expect(latestBack(uploadProps)()).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(true);
    uploadView.unmount();
    await act(async () => upload.resolve({ queued: 1, failed: 0 }));
    expect(uploadProps.onFinish).not.toHaveBeenCalled();

    const invite = deferred();
    context.request.mockReturnValue(invite.promise);
    const inviteProps = flowProps(context, { action: "invite", args: { email: "sam@example.com" } });
    const inviteView = render(<InviteFlow {...inviteProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(latestBack(inviteProps)()).toBe(true));
    inviteView.unmount();
    await act(async () => invite.resolve({ id: "invitation" }));
    expect(inviteProps.onFinish).not.toHaveBeenCalled();
  });
});
