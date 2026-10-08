import { getDataTypeLabel, validateTemplateJsonPayload } from "../templates/templateFields.js";

// Steps describe UI intent; completion comes from the live feature controllers.
export const TOUR_STEPS = [
  {
    id: "create-workspace",
    title: "A space for your documents",
    text: "Click Create workspace to start.",
    action: "workspace",
  },
  {
    id: "workspace-name",
    title: "Make it yours",
    text: "Give your workspace a name, then click Save name.",
    check: "workspaceName",
  },
  {
    id: "nav-templates",
    title: "Choose what to extract",
    text: "Open Templates in the sidebar.",
    click: true,
  },
  {
    id: "create-template",
    title: "Create your first template",
    text: "Click Create template, or use the menu beside it to auto-generate one from a sample.",
    click: true,
  },
  {
    id: "template-name",
    title: "Name your template",
    text: "Name the template, for example Invoice.",
    check: "templateName",
  },
  {
    id: "field-name",
    title: "Start with one value",
    text: "Name your first field, for example Invoice Number.",
    check: "firstName",
  },
  {
    id: "field-description",
    title: "Tell the model what to find",
    text: "Describe what to find, for example: the invoice number near the top of the page.",
    check: "firstDescription",
  },
  {
    id: "field-type",
    title: "Choose the value type",
    text: `Keep ${getDataTypeLabel("string")} for values such as an invoice number.`,
    check: "firstType",
  },
  {
    id: "add-field",
    title: "Add a table field",
    text: "Click Add field to add a table, such as the line items on an invoice.",
    click: true,
  },
  {
    id: "array-name",
    target: "field-name",
    title: "Name the table",
    text: "Use a name such as Line Items.",
    check: "arrayName",
  },
  {
    id: "array-description",
    target: "field-description",
    title: "Describe the table",
    text: "For example: every line item on the invoice.",
    check: "arrayDescription",
  },
  {
    id: "array-type",
    target: "field-type",
    title: `Select ${getDataTypeLabel("array<object>")}`,
    text: `Choose ${getDataTypeLabel("array<object>")} for repeating items, such as invoice lines.`,
    check: "arrayType",
  },
  {
    id: "schema-open",
    title: "Define your table columns",
    text: "Click Edit schema to define the table columns.",
    click: true,
  },
  {
    id: "schema-editor",
    exclude: '[data-tour="schema-close"], [data-tour="schema-done"]',
    title: "Build the columns",
    text: `Click Add column and fill in its name, type and description, such as Item (${getDataTypeLabel("string")}).`,
    check: "schema",
  },
  {
    id: "schema-done",
    title: "Keep your table columns",
    text: "Click Done to return to your template.",
    click: true,
  },
  {
    id: "save-template",
    title: "Save your template",
    text: "Click Save new template to make it available for uploads. Find View JSON under ⋯ More actions.",
    action: "template",
  },
  {
    id: "gateway-workspace",
    target: "nav-workspace",
    title: "Connect a model",
    text: "Open Workspaces to connect the model that reads your documents.",
    click: true,
  },
  {
    id: "model-configuration",
    title: "Set up your model gateway",
    text: "Click Edit, enter your gateway URL, API key and model, then click Save configuration.",
    check: "model",
  },
  {
    id: "upload-open",
    title: "Bring in a document",
    text: "Click Upload documents to add a PDF or image.",
    click: true,
  },
  {
    id: "upload-template",
    title: "Select your template",
    text: "Choose the template you just saved.",
    check: "uploadTemplate",
  },
  {
    id: "upload-files",
    title: "Choose a file",
    text: "Click to browse, or drag a PDF, PNG, JPG or WEBP into the box.",
    check: "files",
  },
  {
    id: "upload-submit",
    title: "Queue the extraction",
    text: "Click Upload documents to start the extraction.",
    action: "upload",
  },
  {
    id: "complete",
    title: "You’re ready to extract",
    text: "Your document is queued. Follow its progress in Documents.",
  },
];

export function canContinueTour(check, { workspace, template, model, upload, busy }) {
  const fields = template.templateFields;

  switch (check) {
    case "workspaceName":
      return Boolean(
        workspace.workspaceName.trim() && !workspace.isWorkspaceNameDirty && !workspace.isSavingWorkspace && !busy,
      );
    case "templateName":
      return Boolean(template.templateName.trim());
    case "firstName":
      return Boolean(fields[0]?.id);
    case "firstDescription":
      return Boolean(fields[0]?.description.trim());
    case "firstType":
      return ["string", "number", "boolean", "date"].includes(fields[0]?.data_type);
    case "arrayName":
      return Boolean(fields[1]?.id && fields[1].id !== fields[0]?.id);
    case "arrayDescription":
      return Boolean(fields[1]?.description.trim());
    case "arrayType":
      return fields[1]?.data_type === "array<object>";
    case "schema":
      try {
        validateTemplateJsonPayload({ name: template.templateName, description: template.templateDescription, fields });

        return true;
      } catch {
        return false;
      }

    case "model":
      return model.ready;
    case "uploadTemplate":
      return Boolean(upload.selectedTemplateId);
    case "files":
      return upload.sourceFiles.some((entry) => entry.queueStatus === "pending");
    default:
      return false;
  }
}
