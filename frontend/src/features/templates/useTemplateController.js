import { useTemplateGeneration } from "./useTemplateGeneration.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_FIELD,
  hydrateFieldFromTemplate,
  serializeTemplatePayload,
  validateTemplateJsonPayload,
} from "./templateFields.js";

const DEFAULT_FIELDS = [
  {
    id: "invoice_number",
    name: "Invoice Number",
    description: "Unique invoice identifier",
    data_type: "string",
  },
  {
    id: "invoice_date",
    name: "Invoice Date",
    description: "Date shown on the invoice",
    data_type: "date",
  },
  {
    id: "vendor_name",
    name: "Vendor Name",
    description: "Name of the supplier issuing the invoice",
    data_type: "string",
  },
  {
    id: "total_amount",
    name: "Total Amount",
    description: "Total amount due on the invoice",
    data_type: "number",
  },
  {
    id: "currency",
    name: "Currency",
    description: "Currency code used for the totals (e.g. USD)",
    data_type: "string",
  },
  {
    id: "line_items",
    name: "Line Items",
    description:
      "List each product or service billed on the invoice",
    data_type: "array<object>",
    object_schema: {
      mode: "table",
      columns: [
        {
          key: "line_number",
          heading: "Line Number",
          data_type: "number",
          description: "Order of the line item on the invoice",
        },
        {
          key: "description",
          heading: "Description",
          data_type: "string",
          description: "Product or service billed on this line",
        },
        {
          key: "quantity",
          heading: "Quantity",
          data_type: "number",
          description: "Number of units billed",
        },
        {
          key: "unit_price",
          heading: "Unit Price",
          data_type: "number",
          description: "Price per unit",
        },
        {
          key: "line_total",
          heading: "Line Total",
          data_type: "number",
          description: "Total amount billed for this line",
        },
      ],
    },
  },
];

const DEFAULT_TEMPLATE_NAME = "Invoice Template";
const DEFAULT_TEMPLATE_DESCRIPTION = "Extract invoice details and line items from a Document";
const DRAFT_TEMPLATE_NAV_ID = "__draft_template__";

export function useTemplateController({
  initialWorkspace = {},
  request,
  addLog,
  showActionToast,
  hasApiAccess,
  workspaceId,
  sessionId = "",
  activePage,
  maxSourceFileBytes,
  onActivePageChange,
}) {
  const [templates, setTemplates] = useState(
    Array.isArray(initialWorkspace.templates) ? initialWorkspace.templates : [],
  );
  const [templateName, setTemplateName] = useState(DEFAULT_TEMPLATE_NAME);
  const [templateDescription, setTemplateDescription] = useState(
    DEFAULT_TEMPLATE_DESCRIPTION,
  );
  const [templateFields, setTemplateFields] = useState(DEFAULT_FIELDS);
  const [hasNewDraftEdits, setHasNewDraftEdits] = useState(false);
  const [loadedTemplateSnapshot, setLoadedTemplateSnapshot] = useState(null);

  const [updateTemplateId, setUpdateTemplateId] = useState("");
  const [selectedUploadTemplateId, setSelectedUploadTemplateId] = useState(
    initialWorkspace.extractTemplateId || "",
  );

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [showTemplateJsonModal, setShowTemplateJsonModal] = useState(false);
  const [templateJsonDraft, setTemplateJsonDraft] = useState("");
  const [templateJsonError, setTemplateJsonError] = useState("");
  const [templateJsonCopied, setTemplateJsonCopied] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [showDraftTemplateNav, setShowDraftTemplateNav] = useState(false);
  const addLogRef = useRef(addLog);
  const requestRef = useRef(request);
  const scope = JSON.stringify([workspaceId, sessionId, hasApiAccess]);
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);
  const editorRequestRef = useRef(0);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    generationRef.current += 1;
  }

  const isEditingTemplate = Boolean(updateTemplateId.trim());
  const buildTemplateJsonPayloadFromEditor = useCallback(() => {
    return validateTemplateJsonPayload(
      {
        name: templateName,
        description: templateDescription,
        fields: templateFields,
      },
      { includeObjectSchema: true },
    );
  }, [templateDescription, templateFields, templateName]);
  const templateDraftSnapshot = useMemo(() => {
    try {
      return serializeTemplatePayload(buildTemplateJsonPayloadFromEditor());
    } catch {
      return null;
    }
  }, [buildTemplateJsonPayloadFromEditor]);
  const isEditedTemplateDirty =
    !isEditingTemplate ||
    !loadedTemplateSnapshot ||
    templateDraftSnapshot !== loadedTemplateSnapshot;

  const templateGeneration = useTemplateGeneration({
    request, workspaceId, sessionId, activePage, templateId: updateTemplateId, hasApiAccess,
    maxSourceFileBytes,
    hasUnsavedChanges: isEditingTemplate ? isEditedTemplateDirty : hasNewDraftEdits,
    onApply: (payload, { createNew }) => {
      editorRequestRef.current += 1;
      setTemplateName(payload.name);
      setTemplateDescription(payload.description || "");
      setTemplateFields(payload.fields.map(hydrateFieldFromTemplate));
      setHasNewDraftEdits(true);
      if (createNew) {
        setUpdateTemplateId("");
        setLoadedTemplateSnapshot(null);
      }
      if (createNew || !isEditingTemplate) setShowDraftTemplateNav(true);
    },
  });
  const cancelGeneration = templateGeneration.cancel;

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) {
      return templates;
    }

    return templates.filter((template) => {
      const name = String(template.name || "").toLowerCase();
      const id = String(template.id || "").toLowerCase();
      const description = String(template.description || "").toLowerCase();
      return (
        name.includes(query) ||
        id.includes(query) ||
        description.includes(query)
      );
    });
  }, [templateSearch, templates]);

  const contextTemplates = useMemo(() => {
    const hasDraft = showDraftTemplateNav && activePage === "templates";
    const draftItem = hasDraft
      ? [{ id: DRAFT_TEMPLATE_NAV_ID, name: "New Template", is_draft: true }]
      : [];
    return [...draftItem, ...filteredTemplates];
  }, [activePage, filteredTemplates, showDraftTemplateNav]);

  const clearWorkspaceScopedTemplates = useCallback(() => {
    generationRef.current += 1;
    cancelGeneration();
    setHasNewDraftEdits(false);
    setTemplates([]);
    setSelectedUploadTemplateId("");
    setUpdateTemplateId("");
    setTemplateName(DEFAULT_TEMPLATE_NAME);
    setTemplateDescription(DEFAULT_TEMPLATE_DESCRIPTION);
    setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
    setLoadedTemplateSnapshot(null);
    setIsSavingTemplate(false);
    setIsDeletingTemplate(false);
    setShowTemplateJsonModal(false);
    setTemplateJsonDraft("");
    setTemplateJsonError("");
    setTemplateJsonCopied(false);
    setTemplateSearch("");
    setShowDraftTemplateNav(false);
  }, [cancelGeneration]);

  useEffect(() => {
    addLogRef.current = addLog;
    requestRef.current = request;
  }, [addLog, request]);

  const listTemplates = useCallback(async () => {
    const generation = generationRef.current;
    const requestId = ++listRequestRef.current;
    const isCurrent = () => generation === generationRef.current && requestId === listRequestRef.current;
    try {
      const data = await requestRef.current("/templates", { method: "GET" });
      if (!isCurrent()) return [];
      const list = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      setSelectedUploadTemplateId((currentTemplateId) =>
        currentTemplateId || !list[0]?.id ? currentTemplateId : list[0].id,
      );
      addLogRef.current(`Loaded ${list.length} templates`);
      return list;
    } catch (error) {
      if (!isCurrent()) return [];
      addLogRef.current(`List templates failed: ${error.message}`);
      return [];
    }
  }, []);

  async function createTemplate() {
    if (isSavingTemplate || templateGeneration.modal.isOpen) {
      return;
    }

    let payload;
    try {
      payload = validateTemplateJsonPayload({
        name: templateName,
        description: templateDescription,
        fields: templateFields,
      });
    } catch (error) {
      addLog(`Create template failed: ${error.message}`);
      showActionToast("template.save", "validation", { reason: "draft" });
      return;
    }

    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setIsSavingTemplate(true);
    try {
      const data = await request("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!isCurrent()) return;
      addLog(`Template created: ${data.template_id}`);
      setUpdateTemplateId(data.template_id);
      setSelectedUploadTemplateId(data.template_id);
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      setShowDraftTemplateNav(false);
      showActionToast("template.save", "success", {
        targetName: data?.name || payload.name,
      });
      await listTemplates();
    } catch (error) {
      if (!isCurrent()) return;
      addLog(`Create template failed: ${error.message}`);
      showActionToast("template.save", "failure", { error });
    } finally {
      if (isCurrent()) setIsSavingTemplate(false);
    }
  }

  async function updateTemplate() {
    if (!updateTemplateId.trim()) {
      addLog("Update template failed: template ID is required");
      return;
    }
    if (isSavingTemplate || templateGeneration.modal.isOpen) {
      return;
    }

    let payload;
    try {
      payload = validateTemplateJsonPayload({
        name: templateName,
        description: templateDescription,
        fields: templateFields,
      });
    } catch (error) {
      addLog(`Update template failed: ${error.message}`);
      showActionToast("template.save", "validation", { reason: "draft" });
      return;
    }

    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setIsSavingTemplate(true);
    try {
      await request(
        `/templates/${encodeURIComponent(updateTemplateId.trim())}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!isCurrent()) return;
      addLog(`Template updated: ${updateTemplateId.trim()}`);
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      showActionToast("template.save", "success", {
        targetName: payload.name,
      });
      await listTemplates();
    } catch (error) {
      if (!isCurrent()) return;
      addLog(`Update template failed: ${error.message}`);
      showActionToast("template.save", "failure", { error });
    } finally {
      if (isCurrent()) setIsSavingTemplate(false);
    }
  }

  function openTemplateJsonModal() {
    setTemplateJsonCopied(false);
    try {
      setTemplateJsonDraft(
        JSON.stringify(buildTemplateJsonPayloadFromEditor(), null, 2),
      );
      setTemplateJsonError("");
    } catch (error) {
      setTemplateJsonDraft(
        JSON.stringify(
          {
            name: templateName,
            description: templateDescription,
            fields: templateFields,
          },
          null,
          2,
        ),
      );
      setTemplateJsonError(error.message);
    }
    setShowTemplateJsonModal(true);
  }

  function closeTemplateJsonModal() {
    if (isSavingTemplate || templateGeneration.modal.isOpen) {
      return;
    }
    setShowTemplateJsonModal(false);
    setTemplateJsonError("");
    setTemplateJsonCopied(false);
  }

  async function copyTemplateJson() {
    try {
      await navigator.clipboard.writeText(templateJsonDraft);
      setTemplateJsonCopied(true);
      showActionToast("clipboard.copyTemplateJson", "success");
      window.setTimeout(() => setTemplateJsonCopied(false), 1600);
    } catch (error) {
      setTemplateJsonError(`Copy failed: ${error.message}`);
      showActionToast("clipboard.copyTemplateJson", "failure", { error });
    }
  }

  async function saveTemplateJsonDraft() {
    if (isSavingTemplate || templateGeneration.modal.isOpen) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(templateJsonDraft);
    } catch {
      setTemplateJsonError("Request body must be valid JSON");
      showActionToast("template.save", "validation", { reason: "json" });
      return;
    }

    let payload;
    try {
      payload = validateTemplateJsonPayload(parsed);
    } catch (error) {
      setTemplateJsonError(error.message);
      showActionToast("template.save", "validation", { reason: "json" });
      return;
    }

    const targetTemplateId = updateTemplateId.trim();
    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setIsSavingTemplate(true);
    try {
      const data = await request(
        targetTemplateId
          ? `/templates/${encodeURIComponent(targetTemplateId)}`
          : "/templates",
        {
          method: targetTemplateId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!isCurrent()) return;
      setTemplateName(payload.name);
      setTemplateDescription(payload.description || "");
      setTemplateFields(payload.fields.map(hydrateFieldFromTemplate));
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      setShowDraftTemplateNav(false);

      if (data?.template_id) {
        setUpdateTemplateId(data.template_id);
        setSelectedUploadTemplateId(data.template_id);
      }

      addLog(
        targetTemplateId
          ? `Template updated: ${targetTemplateId}`
          : `Template created: ${data.template_id}`,
      );
      setTemplateJsonDraft(JSON.stringify(payload, null, 2));
      setTemplateJsonError("");
      setShowTemplateJsonModal(false);
      showActionToast("template.save", "success", {
        targetName: payload.name,
      });
      await listTemplates();
    } catch (error) {
      if (!isCurrent()) return;
      setTemplateJsonError(error.message);
      addLog(
        `${targetTemplateId ? "Update" : "Create"} template failed: ${error.message}`,
      );
      showActionToast("template.save", "failure", { error });
    } finally {
      if (isCurrent()) setIsSavingTemplate(false);
    }
  }

  async function deleteTemplate() {
    cancelGeneration();
    const deletedTemplateId = updateTemplateId.trim();
    if (!deletedTemplateId) {
      addLog("Delete template failed: template ID is required");
      return;
    }
    if (isDeletingTemplate) {
      return;
    }

    if (
      !window.confirm(
        `Delete template ${deletedTemplateId}? This action cannot be undone.`,
      )
    ) {
      return;
    }

    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    setIsDeletingTemplate(true);
    try {
      const deletedTemplateName =
        templates.find((template) => String(template.id || "") === deletedTemplateId)
          ?.name || templateName;
      await request(`/templates/${encodeURIComponent(deletedTemplateId)}`, {
        method: "DELETE",
      });
      if (!isCurrent()) return;
      addLog(`Template deleted: ${deletedTemplateId}`);
      showActionToast("template.delete", "success", {
        targetName: deletedTemplateName,
      });
      const remainingTemplates = await listTemplates();
      if (!isCurrent()) return;
      const nextTemplate = remainingTemplates.find(
        (template) => String(template.id || "").trim() !== deletedTemplateId,
      );

      setShowDraftTemplateNav(false);
      if (nextTemplate?.id) {
        await loadTemplateForEditing(nextTemplate.id);
      } else {
        setUpdateTemplateId("");
        setSelectedUploadTemplateId("");
        setTemplateName(DEFAULT_TEMPLATE_NAME);
        setTemplateDescription(
          DEFAULT_TEMPLATE_DESCRIPTION,
        );
        setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
        setLoadedTemplateSnapshot(null);
      }
    } catch (error) {
      if (!isCurrent()) return;
      addLog(`Delete template failed: ${error.message}`);
      showActionToast("template.delete", "failure", { error });
    } finally {
      if (isCurrent()) setIsDeletingTemplate(false);
    }
  }

  async function loadTemplateForEditing(templateIdOverride = "") {
    cancelGeneration();
    const targetTemplateId = String(
      templateIdOverride || updateTemplateId,
    ).trim();
    if (!targetTemplateId) {
      addLog("Load template failed: template ID is required");
      return;
    }

    const generation = generationRef.current;
    const requestId = ++editorRequestRef.current;
    const isCurrent = () => generation === generationRef.current && requestId === editorRequestRef.current;
    try {
      const template = await request(
        `/templates/${encodeURIComponent(targetTemplateId)}`,
        { method: "GET" },
      );
      if (!isCurrent()) return;
      setShowDraftTemplateNav(false);
      setUpdateTemplateId(targetTemplateId);
      setTemplateName(template.name || "");
      setTemplateDescription(template.description || "");
      setTemplateFields(
        Array.isArray(template.fields) && template.fields.length
          ? template.fields.map(hydrateFieldFromTemplate)
          : [EMPTY_FIELD],
      );
      try {
        setLoadedTemplateSnapshot(
          serializeTemplatePayload(template),
        );
      } catch {
        setLoadedTemplateSnapshot(null);
      }
      setSelectedUploadTemplateId(targetTemplateId);
      addLog(`Loaded template ${targetTemplateId} for editing`);
    } catch (error) {
      if (!isCurrent()) return;
      addLog(`Load template failed: ${error.message}`);
    }
  }

  function startNewTemplateDraft({ empty = false } = {}) {
    cancelGeneration();
    setHasNewDraftEdits(false);
    editorRequestRef.current += 1;
    setShowDraftTemplateNav(true);
    setUpdateTemplateId("");
    setTemplateName(empty ? "" : DEFAULT_TEMPLATE_NAME);
    setTemplateDescription(
      empty ? "" : DEFAULT_TEMPLATE_DESCRIPTION,
    );
    setTemplateFields(empty ? [{ ...EMPTY_FIELD }] : DEFAULT_FIELDS.map((field) => ({ ...field })));
    setLoadedTemplateSnapshot(null);
    addLog("Switched to new template draft");
  }

  function handleTemplateNavigation() {
    const latestTemplateId = String(templates[0]?.id || "").trim();
    if (latestTemplateId) {
      void loadTemplateForEditing(latestTemplateId);
    }
  }

  useEffect(() => {
    clearWorkspaceScopedTemplates();
    if (hasApiAccess) void listTemplates();
    return () => { generationRef.current += 1; };
  }, [hasApiAccess, listTemplates, workspaceId, sessionId, clearWorkspaceScopedTemplates]);

  return {
    templates,
    selectedUploadTemplateId,
    setSelectedUploadTemplateId,
    contextList: {
      search: templateSearch,
      templates: contextTemplates,
      selectedTemplateId: updateTemplateId,
      isEditingTemplate,
      onSearchChange: setTemplateSearch,
      onSelectDraftTemplate: startNewTemplateDraft,
      onSelectTemplate: (templateId) => {
        onActivePageChange("templates");
        loadTemplateForEditing(templateId);
      },
    },
    templatePage: {
      templateName,
      templateDescription,
      templateFields,
      isEditingTemplate,
      isSavingTemplate,
      isEditedTemplateDirty,
      hasApiAccess,
      isGeneratingTemplate: templateGeneration.modal.isOpen,
      onTemplateNameChange: (value) => { setHasNewDraftEdits(true); setTemplateName(value); },
      onTemplateDescriptionChange: (value) => { setHasNewDraftEdits(true); setTemplateDescription(value); },
      onTemplateFieldsChange: (value) => { setHasNewDraftEdits(true); setTemplateFields(value); },
      onAutoGenerate: () => { editorRequestRef.current += 1; templateGeneration.open(); },
      onOpenJsonModal: openTemplateJsonModal,
      onSaveTemplate: isEditingTemplate ? updateTemplate : createTemplate,
    },
    generationModal: templateGeneration.modal,
    jsonModal: {
      isOpen: showTemplateJsonModal,
      draft: templateJsonDraft,
      error: templateJsonError,
      copied: templateJsonCopied,
      isSavingTemplate,
      hasApiAccess,
      onDraftChange: (value) => {
        setTemplateJsonDraft(value);
        setTemplateJsonError("");
        setTemplateJsonCopied(false);
      },
      onSave: saveTemplateJsonDraft,
      onClose: closeTemplateJsonModal,
      onCopy: copyTemplateJson,
    },
    toolbar: {
      templateCount: templates.length,
      isDeletingTemplate,
      selectedTemplateId: updateTemplateId,
      onCreateTemplate: startNewTemplateDraft,
      onAutoGenerateTemplate: () => {
        editorRequestRef.current += 1;
        templateGeneration.open({ createNew: true });
      },
      onDeleteTemplate: deleteTemplate,
    },
    actions: {
      clearWorkspaceScopedTemplates,
      handleTemplateNavigation,
      listTemplates,
    },
  };
}
