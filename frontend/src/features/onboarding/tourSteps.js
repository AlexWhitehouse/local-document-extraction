import { getDataTypeLabel, validateTemplateJsonPayload } from "../templates/templateFields.js";

// Steps describe UI intent; completion comes from the real feature controllers.
export const TOUR_STEPS = [
  { id: "create-workspace", title: "A space for your documents", text: "Workspaces keep templates, documents and teammates together. Click Create Workspace to create a real workspace for this walkthrough.", action: "workspace" },
  { id: "workspace-name", title: "Make it yours", text: "Give your workspace a useful name, then click Save name. Everything you create during this tour stays in this workspace.", check: "workspaceName" },
  { id: "nav-templates", title: "Choose what to extract", text: "Open Templates. A template describes the information you want to find in each document.", click: true },
  { id: "create-template", title: "Create your first template", text: "Click Create Template to begin a fresh extraction schema.", click: true },
  { id: "template-name", title: "Name your template", text: "Choose a name such as Invoice. You’ll select this template when you upload a document.", check: "templateName" },
  { id: "field-name", title: "Start with one value", text: "Name your first field, for example Invoice Number. Field IDs are generated from these names.", check: "firstName" },
  { id: "field-description", title: "Tell the model what to find", text: "Write clear extraction instructions, such as: The invoice identifier printed near the top of the document.", check: "firstDescription" },
  { id: "field-type", title: "Choose the value type", text: `Keep ${getDataTypeLabel("string")} for text such as an invoice number. Other types include ${getDataTypeLabel("number")}, ${getDataTypeLabel("boolean")} and ${getDataTypeLabel("date")}. Next, we’ll build a table of repeating items.`, check: "firstType" },
  { id: "add-field", title: "Add a table field", text: "Click Add field. This time we’ll describe a table, such as the line items on an invoice.", click: true },
  { id: "array-name", target: "field-name", title: "Name the table", text: "Give this field a different name, such as Line Items.", check: "arrayName" },
  { id: "array-description", target: "field-description", title: "Describe the table", text: "For example: Extract every line item on the invoice, with one row per item.", check: "arrayDescription" },
  { id: "array-type", target: "field-type", title: `Select ${getDataTypeLabel("array<object>")}`, text: `Choose ${getDataTypeLabel("array<object>")}. It extracts repeating records as rows with the same columns—ideal for invoice lines, medications or other repeating information.`, check: "arrayType" },
  { id: "schema-open", title: "Define your table columns", text: "Click Edit Schema to define the columns that every row in your table should contain.", click: true },
  { id: "schema-editor", exclude: '[data-tour="schema-close"], [data-tour="schema-done"]', title: "Build the columns", text: `Click Add Column and fill in its name, type and description. Try Item (${getDataTypeLabel("string")}, the item’s name) and Quantity (${getDataTypeLabel("number")}, the number ordered). Each column needs a unique name and instructions.`, check: "schema" },
  { id: "schema-done", title: "Keep your table columns", text: "Click Done to return to your template. The column changes are already in your draft.", click: true },
  { id: "save-template", title: "Save your template", text: "Save the template so it becomes available for document uploads. If saving fails, you can retry here.", action: "template" },
  { id: "gateway-workspace", target: "nav-workspace", title: "Connect a model", text: "Your template is saved. Open Workspaces to connect the model that will read your documents.", click: true },
  { id: "model-configuration", title: "Set up your model gateway", text: "Enter your OpenAI-compatible gateway URL, model name and gateway API key, then Save configuration. You can test the connection here too. If you don’t have these yet, exit the tour and restart it later.", check: "model" },
  { id: "upload-open", title: "Bring in a document", text: "Click Upload Document to use your template with a PDF or image.", click: true },
  { id: "upload-template", title: "Select your template", text: "Choose the template you just saved. It tells Studio which fields and table columns to extract.", check: "uploadTemplate" },
  { id: "upload-files", title: "Choose a source file", text: "Click to browse, or drag a PDF, PNG, JPG or WEBP into this box. Use a document that matches the template you created.", check: "files" },
  { id: "upload-submit", title: "Queue the extraction", text: "Click Upload Documents. Studio will send the document to your configured model. If an upload fails, retry here or exit the tour to change your settings.", action: "upload" },
  { id: "complete", title: "You’re ready to extract", text: "Your document has been queued. Close the tour to follow its progress in Documents and see the extracted values when processing finishes. Your workspace and template are ready to reuse." },
];

export function canContinueTour(check, { workspace, template, model, upload, busy }) {
  const fields = template.templateFields;
  switch (check) {
    case "workspaceName": return Boolean(workspace.workspaceName.trim() && !workspace.isWorkspaceNameDirty && !workspace.isSavingWorkspace && !busy);
    case "templateName": return Boolean(template.templateName.trim());
    case "firstName": return Boolean(fields[0]?.id);
    case "firstDescription": return Boolean(fields[0]?.description.trim());
    case "firstType": return ["string", "number", "boolean", "date"].includes(fields[0]?.data_type);
    case "arrayName": return Boolean(fields[1]?.id && fields[1].id !== fields[0]?.id);
    case "arrayDescription": return Boolean(fields[1]?.description.trim());
    case "arrayType": return fields[1]?.data_type === "array<object>";
    case "schema":
      try {
        validateTemplateJsonPayload({ name: template.templateName, description: template.templateDescription, fields });
        return true;
      } catch { return false; }
    case "model": return model.ready;
    case "uploadTemplate": return Boolean(upload.selectedTemplateId);
    case "files": return upload.sourceFiles.some((entry) => entry.queueStatus === "pending");
    default: return false;
  }
}
