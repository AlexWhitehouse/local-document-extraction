import { useEffect, useMemo, useState } from "react";

import {
  EMPTY_FIELD,
  hydrateFieldFromTemplate,
  serializeTemplatePayload,
  validateTemplateJsonPayload,
} from "./templateFields.js";

const DEFAULT_FIELDS = [
  {
    id: "patient_name",
    name: "Patient Name",
    description: "Full name of the patient on the prescription",
    data_type: "string",
  },
  {
    id: "medication_name",
    name: "Medication Name",
    description: "Name of the prescribed medication",
    data_type: "string",
  },
  {
    id: "dosage",
    name: "Dosage",
    description: "Strength and amount per dose (e.g. 10 mg)",
    data_type: "string",
  },
  {
    id: "frequency",
    name: "Frequency",
    description: "How often the medication should be taken",
    data_type: "string",
  },
  {
    id: "prescriber_name",
    name: "Prescriber Name",
    description: "Name of the prescribing clinician",
    data_type: "string",
  },
  {
    id: "prescription_lines",
    name: "Prescription Lines",
    description:
      "List each prescribed medication line when the document contains multiple medications",
    data_type: "array<object>",
    object_schema: {
      mode: "table",
      columns: [
        {
          key: "line_number",
          heading: "Line Number",
          data_type: "number",
          description: "Order of the medication line on the prescription",
        },
        {
          key: "medication_name",
          heading: "Medication Name",
          data_type: "string",
          description: "Medication listed on this line",
        },
        {
          key: "strength",
          heading: "Strength",
          data_type: "string",
          description: "Strength for this medication line (for example 10 mg)",
        },
        {
          key: "dose_instructions",
          heading: "Dose Instructions",
          data_type: "string",
          description: "Dose and frequency instructions for this line",
        },
        {
          key: "duration",
          heading: "Duration",
          data_type: "string",
          description: "How long this medication should be taken",
        },
      ],
    },
  },
];

const DRAFT_TEMPLATE_NAV_ID = "__draft_template__";

export function useTemplateController({
  initialWorkspace = {},
  request,
  addLog,
  showActionToast,
  hasApiAccess,
  workspaceId,
  activePage,
  onActivePageChange,
}) {
  const [templates, setTemplates] = useState(
    Array.isArray(initialWorkspace.templates) ? initialWorkspace.templates : [],
  );
  const [templateName, setTemplateName] = useState("Prescription Template");
  const [templateDescription, setTemplateDescription] = useState(
    "Extract medication and prescription fields from a Document",
  );
  const [templateFields, setTemplateFields] = useState(DEFAULT_FIELDS);
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

  const isEditingTemplate = Boolean(updateTemplateId.trim());
  const templateDraftSnapshot = useMemo(() => {
    try {
      return serializeTemplatePayload(buildTemplateJsonPayloadFromEditor());
    } catch {
      return null;
    }
  }, [templateDescription, templateFields, templateName]);
  const isEditedTemplateDirty =
    !isEditingTemplate ||
    !loadedTemplateSnapshot ||
    templateDraftSnapshot !== loadedTemplateSnapshot;

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

  function clearWorkspaceScopedTemplates() {
    setTemplates([]);
    setSelectedUploadTemplateId("");
  }

  async function listTemplates() {
    try {
      const data = await request("/templates", { method: "GET" });
      const list = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      if (!selectedUploadTemplateId && list.length > 0) {
        setSelectedUploadTemplateId(list[0].id);
      }
      addLog(`Loaded ${list.length} templates`);
      return list;
    } catch (error) {
      addLog(`List templates failed: ${error.message}`);
      return [];
    }
  }

  async function createTemplate() {
    if (isSavingTemplate) {
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

    setIsSavingTemplate(true);
    try {
      const data = await request("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
      addLog(`Create template failed: ${error.message}`);
      showActionToast("template.save", "failure", { error });
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function updateTemplate() {
    if (!updateTemplateId.trim()) {
      addLog("Update template failed: template ID is required");
      return;
    }
    if (isSavingTemplate) {
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
      addLog(`Template updated: ${updateTemplateId.trim()}`);
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      showActionToast("template.save", "success", {
        targetName: payload.name,
      });
      await listTemplates();
    } catch (error) {
      addLog(`Update template failed: ${error.message}`);
      showActionToast("template.save", "failure", { error });
    } finally {
      setIsSavingTemplate(false);
    }
  }

  function buildTemplateJsonPayloadFromEditor() {
    return validateTemplateJsonPayload(
      {
        name: templateName,
        description: templateDescription,
        fields: templateFields,
      },
      { includeObjectSchema: true },
    );
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
    if (isSavingTemplate) {
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
    if (isSavingTemplate) {
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
      setTemplateJsonError(error.message);
      addLog(
        `${targetTemplateId ? "Update" : "Create"} template failed: ${error.message}`,
      );
      showActionToast("template.save", "failure", { error });
    } finally {
      setIsSavingTemplate(false);
    }
  }

  async function deleteTemplate() {
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

    setIsDeletingTemplate(true);
    try {
      const deletedTemplateName =
        templates.find((template) => String(template.id || "") === deletedTemplateId)
          ?.name || templateName;
      await request(`/templates/${encodeURIComponent(deletedTemplateId)}`, {
        method: "DELETE",
      });
      addLog(`Template deleted: ${deletedTemplateId}`);
      showActionToast("template.delete", "success", {
        targetName: deletedTemplateName,
      });
      const remainingTemplates = await listTemplates();
      const nextTemplate = remainingTemplates.find(
        (template) => String(template.id || "").trim() !== deletedTemplateId,
      );

      setShowDraftTemplateNav(false);
      if (nextTemplate?.id) {
        await loadTemplateForEditing(nextTemplate.id);
      } else {
        setUpdateTemplateId("");
        setSelectedUploadTemplateId("");
        setTemplateName("Prescription Template");
        setTemplateDescription(
          "Extract medication and prescription fields from a Document",
        );
        setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
        setLoadedTemplateSnapshot(null);
      }
    } catch (error) {
      addLog(`Delete template failed: ${error.message}`);
      showActionToast("template.delete", "failure", { error });
    } finally {
      setIsDeletingTemplate(false);
    }
  }

  async function loadTemplateForEditing(templateIdOverride = "") {
    const targetTemplateId = String(
      templateIdOverride || updateTemplateId,
    ).trim();
    if (!targetTemplateId) {
      addLog("Load template failed: template ID is required");
      return;
    }

    try {
      const template = await request(
        `/templates/${encodeURIComponent(targetTemplateId)}`,
        { method: "GET" },
      );
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
          serializeTemplatePayload(validateTemplateJsonPayload(template)),
        );
      } catch {
        setLoadedTemplateSnapshot(null);
      }
      setSelectedUploadTemplateId(targetTemplateId);
      addLog(`Loaded template ${targetTemplateId} for editing`);
    } catch (error) {
      addLog(`Load template failed: ${error.message}`);
    }
  }

  function startNewTemplateDraft() {
    setShowDraftTemplateNav(true);
    setUpdateTemplateId("");
    setTemplateName("Prescription Template");
    setTemplateDescription(
      "Extract medication and prescription fields from a Document",
    );
    setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
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
    if (!hasApiAccess) {
      setTemplates([]);
      return;
    }

    void listTemplates();
  }, [hasApiAccess, workspaceId]);

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
      onTemplateNameChange: setTemplateName,
      onTemplateDescriptionChange: setTemplateDescription,
      onTemplateFieldsChange: setTemplateFields,
      onOpenJsonModal: openTemplateJsonModal,
      onSaveTemplate: isEditingTemplate ? updateTemplate : createTemplate,
    },
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
      onDeleteTemplate: deleteTemplate,
    },
    actions: {
      clearWorkspaceScopedTemplates,
      handleTemplateNavigation,
      listTemplates,
    },
  };
}
