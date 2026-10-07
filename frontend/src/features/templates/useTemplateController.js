import { normalizeTemplateTagName, normalizeTemplateTags } from "../../../../shared/templateTags.ts";
import { useTemplateAssistant } from "./useTemplateAssistant.js";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { useTemplateGeneration } from "./useTemplateGeneration.js";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { copyWithFeedback } from "../../lib/copyWithFeedback";
import { describeError } from "../../lib/describeError";
import { defaultToast } from "../../lib/notify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_FIELD,
  describeJsonSyntaxError,
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
    description: "List each product or service billed on the invoice",
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

const copyDefaultFields = () => DEFAULT_FIELDS.map((field) => ({ ...field }));

const replaceTagName = (tags, before, after) =>
  normalizeTemplateTags(
    (tags ?? []).flatMap((value) => (value === before ? (after === null ? [] : [after]) : [value])),
  );

export function useTemplateController({
  initialWorkspace = {},
  request,
  showActionToast,
  toast = defaultToast,
  hasApiAccess,
  workspaceId,
  sessionId = "",
  activePage,
  maxSourceFileBytes,
  onActivePageChange,
  routeTemplateId,
  onTemplateNavigation,
}) {
  const [routeLoad, setRouteLoad] = useState({ id: "", status: "idle" });
  const navigationRef = useRef(onTemplateNavigation);
  navigationRef.current = onTemplateNavigation;
  const [isJsonDraftDirty, setIsJsonDraftDirty] = useState(false);

  const [templates, setTemplates] = useState(
    Array.isArray(initialWorkspace.templates) ? initialWorkspace.templates : [],
  );

  const [templateName, setTemplateName] = useState(DEFAULT_TEMPLATE_NAME);

  const [templateDescription, setTemplateDescription] = useState(DEFAULT_TEMPLATE_DESCRIPTION);

  const [templateTags, setTemplateTags] = useState([]);
  const [workspaceTags, setWorkspaceTags] = useState([]);
  const [tagListError, setTagListError] = useState("");
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isManagingTags, setIsManagingTags] = useState(false);
  const tagListRequestRef = useRef(null);
  const tagMutationRef = useRef(null);
  const completedTagChangesRef = useRef([]);
  const [templateFields, setTemplateFields] = useState(DEFAULT_FIELDS);
  const [hasNewDraftEdits, setHasNewDraftEdits] = useState(false);
  const [loadedTemplateSnapshot, setLoadedTemplateSnapshot] = useState(null);
  const [templateVersion, setTemplateVersion] = useState(null);

  const [updateTemplateId, setUpdateTemplateId] = useState("");

  const [selectedUploadTemplateId, setSelectedUploadTemplateId] = useState(initialWorkspace.extractTemplateId || "");

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [showTemplateJsonModal, setShowTemplateJsonModal] = useState(false);
  const [templateJsonDraft, setTemplateJsonDraft] = useState("");
  const [templateJsonError, setTemplateJsonError] = useState("");
  const [templateJsonDiagnostics, setTemplateJsonDiagnostics] = useState([]);
  const [templateJsonCopied, setTemplateJsonCopied] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [showDraftTemplateNav, setShowDraftTemplateNav] = useState(false);
  const draftRevisionRef = useRef(0);
  const [draftRevision, setDraftRevision] = useState(0);
  const [validationFocus, setValidationFocus] = useState(null);
  const assistantRef = useRef(null);

  const touchDraft = useCallback(({ preservePendingLoad = false } = {}) => {
    draftRevisionRef.current += 1;
    setDraftRevision(draftRevisionRef.current);

    if (!preservePendingLoad) editorRequestRef.current += 1;
    assistantRef.current?.invalidate();
  }, []);

  const requestRef = useRef(request);
  const scope = JSON.stringify([workspaceId, sessionId, hasApiAccess]);
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);
  const editorRequestRef = useRef(0);
  const saveRequestRef = useRef(0);

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
        tags: templateTags,
        fields: templateFields,
      },
      { includeObjectSchema: true },
    );
  }, [templateDescription, templateFields, templateName, templateTags]);

  const templateDraftSnapshot = useMemo(() => {
    try {
      return serializeTemplatePayload(buildTemplateJsonPayloadFromEditor());
    } catch {
      return null;
    }
  }, [buildTemplateJsonPayloadFromEditor]);

  const isEditedTemplateDirty =
    !isEditingTemplate || !loadedTemplateSnapshot || templateDraftSnapshot !== loadedTemplateSnapshot;

  const templateGeneration = useTemplateGeneration({
    request,
    workspaceId,
    sessionId,
    activePage,
    templateId: updateTemplateId,
    hasApiAccess,
    maxSourceFileBytes,
    hasUnsavedChanges: isEditingTemplate ? isEditedTemplateDirty : hasNewDraftEdits,
    onApply: (payload, { createNew }) => {
      touchDraft();
      setTemplateName(payload.name);
      setTemplateDescription(payload.description || "");
      setTemplateFields(payload.fields.map(hydrateFieldFromTemplate));
      setHasNewDraftEdits(true);

      if (createNew || !isEditingTemplate) setTemplateTags([]);

      if (createNew) {
        setUpdateTemplateId("");
        setLoadedTemplateSnapshot(null);
      }

      if (createNew || !isEditingTemplate) setShowDraftTemplateNav(true);

      if (createNew) navigationRef.current?.("new", { force: true });
    },
  });

  const cancelGeneration = templateGeneration.cancel;

  const assistant = useTemplateAssistant({
    request,
    workspaceId,
    sessionId,
    activePage,
    templateId: updateTemplateId,
    templateVersion,
    hasApiAccess,
    draft: { name: templateName, description: templateDescription, fields: templateFields },
    revision: draftRevision,
    getRevision: () => draftRevisionRef.current,
    maxSourceFileBytes,
    onApply: (payload) => {
      // The proposal engine preserves unrelated raw values; do not normalize/hydrate here.
      touchDraft();
      setTemplateName(payload.name);
      setTemplateDescription(payload.description);
      setTemplateFields(payload.fields);
      setHasNewDraftEdits(true);

      if (!isEditingTemplate) setShowDraftTemplateNav(true);
    },
  });

  assistantRef.current = assistant;
  const cancelAssistant = assistant.cancel;

  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();

    if (!query) {
      return templates;
    }

    return templates.filter((template) => {
      const name = String(template.name || "").toLowerCase();
      const id = String(template.id || "").toLowerCase();
      const description = String(template.description || "").toLowerCase();

      return name.includes(query) || id.includes(query) || description.includes(query);
    });
  }, [templateSearch, templates]);

  const contextTemplates = useMemo(() => {
    const hasDraft = showDraftTemplateNav && activePage === "templates";

    const draftItem = hasDraft ? [{ id: DRAFT_TEMPLATE_NAV_ID, name: "New Template", is_draft: true }] : [];

    return [...draftItem, ...filteredTemplates];
  }, [activePage, filteredTemplates, showDraftTemplateNav]);

  const clearWorkspaceScopedTemplates = useCallback(() => {
    generationRef.current += 1;
    saveRequestRef.current += 1;
    setRouteLoad({ id: "", status: "idle" });
    setIsJsonDraftDirty(false);
    tagListRequestRef.current?.abort();
    tagMutationRef.current?.abort();
    tagListRequestRef.current = null;
    tagMutationRef.current = null;
    completedTagChangesRef.current = [];
    setTemplateTags([]);
    setWorkspaceTags([]);
    setTagListError("");
    setIsLoadingTags(false);
    setIsManagingTags(false);
    touchDraft();
    cancelAssistant();
    setValidationFocus(null);
    cancelGeneration();
    setHasNewDraftEdits(false);
    setTemplates([]);
    setSelectedUploadTemplateId("");
    setUpdateTemplateId("");
    setTemplateName(DEFAULT_TEMPLATE_NAME);
    setTemplateDescription(DEFAULT_TEMPLATE_DESCRIPTION);
    setTemplateFields(copyDefaultFields());
    setLoadedTemplateSnapshot(null);
    setTemplateVersion(null);
    setIsSavingTemplate(false);
    setIsDeletingTemplate(false);
    setShowTemplateJsonModal(false);
    setTemplateJsonDraft("");
    setTemplateJsonError("");
    setTemplateJsonDiagnostics([]);
    setTemplateJsonCopied(false);
    setTemplateSearch("");
    setShowDraftTemplateNav(false);
  }, [cancelGeneration, cancelAssistant, touchDraft]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

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

      return list;
    } catch {
      return [];
    }
  }, []);

  const listTemplateTags = useCallback(async () => {
    tagListRequestRef.current?.abort();
    const controller = new AbortController();
    tagListRequestRef.current = controller;
    const generation = generationRef.current;

    const isCurrent = () =>
      generation === generationRef.current && tagListRequestRef.current === controller && !controller.signal.aborted;

    setIsLoadingTags(true);
    setTagListError("");

    try {
      const data = await requestRef.current("/template-tags", { method: "GET", signal: controller.signal });

      if (isCurrent()) setWorkspaceTags(Array.isArray(data?.tags) ? data.tags : []);
    } catch (error) {
      if (isCurrent()) setTagListError(describeError(error, "Couldn't load tags. Try again."));
    } finally {
      if (isCurrent()) setIsLoadingTags(false);
    }
  }, []);

  function buildSavePayload(payload) {
    if (!updateTemplateId || !loadedTemplateSnapshot) return payload;
    const saved = JSON.parse(loadedTemplateSnapshot);

    // Omit unchanged fields to preserve versions, and unchanged tags so a stale
    // editor cannot undo another member's shared tag rename or deletion.
    return Object.fromEntries(
      Object.entries(payload).filter(([key, value]) => JSON.stringify(saved[key]) !== JSON.stringify(value)),
    );
  }

  async function mutateTemplateTag(tag, name) {
    if (!hasApiAccess || isSavingTemplate || templateGeneration.modal.isOpen || tagMutationRef.current) return false;
    const normalizedName = name === undefined ? undefined : normalizeTemplateTagName(name);

    if (normalizedName === tag.name) return true;
    const controller = new AbortController();
    tagMutationRef.current = controller;
    const generation = generationRef.current;

    const isCurrent = () =>
      generation === generationRef.current && tagMutationRef.current === controller && !controller.signal.aborted;

    setIsManagingTags(true);
    touchDraft({ preservePendingLoad: true });

    try {
      const options = { method: normalizedName === undefined ? "DELETE" : "PATCH", signal: controller.signal };

      if (normalizedName !== undefined) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify({ name: normalizedName });
      }

      const data = await requestRef.current(`/template-tags/${encodeURIComponent(tag.id)}`, options);

      if (!isCurrent()) return false;
      const nextName = normalizedName === undefined ? null : data.name;
      const replaceTag = (tags) => replaceTagName(tags, tag.name, nextName);
      completedTagChangesRef.current.push({ before: tag.name, after: nextName });
      // Shared edits also update the saved baseline, preserving unrelated unsaved changes.
      touchDraft({ preservePendingLoad: true });
      setTemplateTags(replaceTag);
      setLoadedTemplateSnapshot((snapshot) =>
        snapshot ? JSON.stringify({ ...JSON.parse(snapshot), tags: replaceTag(JSON.parse(snapshot).tags) }) : snapshot,
      );
      setTemplates((current) => current.map((template) => ({ ...template, tags: replaceTag(template.tags) })));
      setWorkspaceTags((current) =>
        current
          .flatMap((item) => (item.id === tag.id ? (nextName === null ? [] : [{ ...item, ...data }]) : [item]))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      const actionKey = normalizedName === undefined ? "tag.delete" : "tag.rename";
      showActionToast(actionKey, "success", { targetName: nextName ?? tag.name });
      // A list started before the mutation must not restore the old shared name.
      tagListRequestRef.current?.abort();
      listRequestRef.current += 1;
      await listTemplateTags();

      return isCurrent();
    } catch (error) {
      if (!isCurrent()) return false;

      // A duplicate name is a field problem, so the tag popover shows it inline.
      if (error.code === "tag_name_conflict") throw error;

      showActionToast(normalizedName === undefined ? "tag.delete" : "tag.rename", "failure", { error });

      return false;
    } finally {
      if (isCurrent()) {
        tagMutationRef.current = null;
        setIsManagingTags(false);
      }
    }
  }

  function renameTemplateTag(tag, name) {
    return mutateTemplateTag(tag, name);
  }

  function deleteTemplateTag(tag) {
    return mutateTemplateTag(tag);
  }

  async function saveTemplate() {
    if (isSavingTemplate || isManagingTags || templateGeneration.modal.isOpen) {
      return;
    }

    touchDraft();
    const targetTemplateId = updateTemplateId.trim();
    let payload;

    try {
      payload = validateTemplateJsonPayload({
        name: templateName,
        description: templateDescription,
        tags: templateTags,
        fields: templateFields,
      });
    } catch (error) {
      const issues =
        error.diagnostics ||
        diagnoseTemplateDraft({ name: templateName, description: templateDescription, fields: templateFields });

      setValidationFocus({ issue: issues[0], nonce: draftRevisionRef.current });
      showActionToast("template.save", "validation", { reason: "draft" });

      return;
    }

    const generation = generationRef.current;
    const saveRequest = ++saveRequestRef.current;
    const isCurrent = () => generation === generationRef.current && saveRequest === saveRequestRef.current;
    const savePayload = buildSavePayload(payload);

    if (!Object.keys(savePayload).length) return;
    setIsSavingTemplate(true);

    try {
      const data = await request(
        targetTemplateId ? `/templates/${encodeURIComponent(targetTemplateId)}` : "/templates",
        {
          method: targetTemplateId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        },
      );

      if (!isCurrent()) return;
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      setHasNewDraftEdits(false);
      setTemplateVersion(
        data.version ??
          data.template_version ??
          (targetTemplateId && templateVersion ? templateVersion + (savePayload.fields ? 1 : 0) : 1),
      );

      if (!targetTemplateId) {
        setUpdateTemplateId(data.template_id);
        setSelectedUploadTemplateId(data.template_id);
        setShowDraftTemplateNav(false);
        navigationRef.current?.(data.template_id, { replace: true, force: true });
      }

      showActionToast("template.save", "success", {
        targetName: (!targetTemplateId && data?.name) || payload.name,
      });
      await Promise.all([listTemplates(), listTemplateTags()]);
    } catch (error) {
      if (!isCurrent()) return;
      showActionToast("template.save", "failure", { error });
    } finally {
      if (isCurrent()) setIsSavingTemplate(false);
    }
  }

  function openTemplateJsonModal() {
    touchDraft();
    setTemplateJsonCopied(false);

    try {
      setTemplateJsonDraft(JSON.stringify(buildTemplateJsonPayloadFromEditor(), null, 2));
      setTemplateJsonError("");
      setTemplateJsonDiagnostics([]);
    } catch (error) {
      setTemplateJsonDraft(
        JSON.stringify(
          {
            name: templateName,
            description: templateDescription,
            tags: templateTags,
            fields: templateFields,
          },
          null,
          2,
        ),
      );
      setTemplateJsonError(error.message);
      setTemplateJsonDiagnostics(error.diagnostics || []);
    }

    setShowTemplateJsonModal(true);
    setIsJsonDraftDirty(false);
  }

  function closeTemplateJsonModal() {
    if (isSavingTemplate || isManagingTags || templateGeneration.modal.isOpen) {
      return;
    }

    setShowTemplateJsonModal(false);
    setTemplateJsonError("");
    setTemplateJsonDiagnostics([]);
    setTemplateJsonCopied(false);
  }

  async function copyTemplateJson() {
    // copyWithFeedback owns the only message; the button's check mark is the in-place cue.
    const copied = await copyWithFeedback(toast, templateJsonDraft, "Template JSON");

    setTemplateJsonCopied(copied);

    if (copied) window.setTimeout(() => setTemplateJsonCopied(false), 1600);
  }

  async function saveTemplateJsonDraft() {
    touchDraft();

    if (isSavingTemplate || isManagingTags || templateGeneration.modal.isOpen) {
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(templateJsonDraft);
    } catch (error) {
      // Errors inside the open modal are inline only; no toast repeats them.
      setTemplateJsonError(describeJsonSyntaxError(error, templateJsonDraft));

      return;
    }

    let payload;

    try {
      payload = validateTemplateJsonPayload({
        ...parsed,
        tags: parsed?.tags === undefined ? templateTags : parsed.tags,
      });
    } catch (error) {
      setTemplateJsonError(error.message);
      setTemplateJsonDiagnostics(error.diagnostics || []);

      return;
    }

    const targetTemplateId = updateTemplateId.trim();
    const generation = generationRef.current;
    const saveRequest = ++saveRequestRef.current;
    const isCurrent = () => generation === generationRef.current && saveRequest === saveRequestRef.current;
    const savePayload = buildSavePayload(payload);

    if (!Object.keys(savePayload).length) {
      setTemplateName(payload.name);
      setTemplateDescription(payload.description || "");
      setTemplateTags(payload.tags);
      setTemplateFields(payload.fields.map(hydrateFieldFromTemplate));
      setTemplateJsonDraft(JSON.stringify(payload, null, 2));
      setShowTemplateJsonModal(false);
      setTemplateJsonError("");
      setTemplateJsonDiagnostics([]);

      return;
    }

    setIsSavingTemplate(true);

    try {
      const data = await request(
        targetTemplateId ? `/templates/${encodeURIComponent(targetTemplateId)}` : "/templates",
        {
          method: targetTemplateId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        },
      );

      if (!isCurrent()) return;
      setTemplateName(payload.name);
      setTemplateDescription(payload.description || "");
      setTemplateTags(payload.tags);
      setTemplateFields(payload.fields.map(hydrateFieldFromTemplate));
      setLoadedTemplateSnapshot(serializeTemplatePayload(payload));
      setHasNewDraftEdits(false);
      setTemplateVersion(
        data.version ??
          data.template_version ??
          (targetTemplateId && templateVersion ? templateVersion + (savePayload.fields ? 1 : 0) : 1),
      );
      setShowDraftTemplateNav(false);

      if (data?.template_id) {
        setUpdateTemplateId(data.template_id);
        setSelectedUploadTemplateId(data.template_id);
        navigationRef.current?.(data.template_id, { replace: true, force: true });
      }

      setTemplateJsonDraft(JSON.stringify(payload, null, 2));
      setTemplateJsonError("");
      setTemplateJsonDiagnostics([]);
      setShowTemplateJsonModal(false);
      showActionToast("template.save", "success", {
        targetName: payload.name,
      });
      await Promise.all([listTemplates(), listTemplateTags()]);
    } catch (error) {
      if (!isCurrent()) return;
      setTemplateJsonError(describeError(error, "Couldn't save the template. Try again."));
      setTemplateJsonDiagnostics(error.diagnostics || []);
    } finally {
      if (isCurrent()) setIsSavingTemplate(false);
    }
  }

  async function deleteTemplate() {
    const deletedTemplateId = updateTemplateId.trim();

    if (!deletedTemplateId) {
      return;
    }

    if (isDeletingTemplate) {
      return;
    }

    const deletedTemplateName =
      templates.find((template) => String(template.id || "") === deletedTemplateId)?.name || templateName;

    let generation = null;

    const confirmed = await confirmDialog({
      title: `Delete "${deletedTemplateName}"?`,
      body: "Documents already extracted with it keep their results. This can't be undone.",
      confirmLabel: "Delete template",
      pendingLabel: "Deleting…",
      // Runs only once the user confirms; a failure stays inline in the dialog.
      action: async () => {
        touchDraft();
        cancelAssistant();
        cancelGeneration();
        generation = generationRef.current;
        setIsDeletingTemplate(true);

        await request(`/templates/${encodeURIComponent(deletedTemplateId)}`, {
          method: "DELETE",
        });
      },
    });

    if (!confirmed) {
      setIsDeletingTemplate(false);

      return;
    }

    const isCurrent = () => generation === generationRef.current;

    try {
      if (!isCurrent()) return;
      showActionToast("template.delete", "success", {
        targetName: deletedTemplateName,
      });
      const [remainingTemplates] = await Promise.all([listTemplates(), listTemplateTags()]);

      if (!isCurrent()) return;

      const nextTemplate = remainingTemplates.find(
        (template) => String(template.id || "").trim() !== deletedTemplateId,
      );

      setShowDraftTemplateNav(false);

      if (navigationRef.current) {
        setHasNewDraftEdits(false);
        setLoadedTemplateSnapshot(null);
        setUpdateTemplateId("");
        navigationRef.current(nextTemplate?.id || "new", { replace: true, force: true });

        return;
      }

      if (nextTemplate?.id) {
        await loadTemplateForEditing(nextTemplate.id);
      } else {
        setUpdateTemplateId("");
        setSelectedUploadTemplateId("");
        setTemplateName(DEFAULT_TEMPLATE_NAME);
        setTemplateDescription(DEFAULT_TEMPLATE_DESCRIPTION);
        setTemplateTags([]);
        setTemplateFields(copyDefaultFields());
        setLoadedTemplateSnapshot(null);
      }
    } catch (error) {
      if (!isCurrent()) return;
      showActionToast("template.delete", "failure", { error });
    } finally {
      if (isCurrent()) setIsDeletingTemplate(false);
    }
  }

  async function loadTemplateForEditing(templateIdOverride = "") {
    saveRequestRef.current += 1;
    setIsSavingTemplate(false);
    setShowTemplateJsonModal(false);
    setIsJsonDraftDirty(false);
    touchDraft();
    cancelAssistant();
    cancelGeneration();

    const targetTemplateId = String(templateIdOverride || updateTemplateId).trim();

    if (!targetTemplateId) {
      return;
    }

    const generation = generationRef.current;
    const requestId = ++editorRequestRef.current;
    const tagRevision = completedTagChangesRef.current.length;
    const isCurrent = () => generation === generationRef.current && requestId === editorRequestRef.current;
    setRouteLoad({ id: targetTemplateId, status: "loading" });

    try {
      const loaded = await request(`/templates/${encodeURIComponent(targetTemplateId)}`, { method: "GET" });

      if (!isCurrent()) return;

      // Navigation may overlap shared mutations. Reconcile a detail response
      // captured before those mutations so it cannot restore old tag names.
      const template = {
        ...loaded,
        tags: completedTagChangesRef.current
          .slice(tagRevision)
          .reduce(
            (tags, change) => replaceTagName(tags, change.before, change.after),
            normalizeTemplateTags(loaded.tags ?? []),
          ),
      };

      setShowDraftTemplateNav(false);
      setHasNewDraftEdits(false);
      setUpdateTemplateId(targetTemplateId);
      setTemplateVersion(template.current_version ?? template.version ?? template.template_version ?? null);
      setTemplateName(template.name || "");
      setTemplateDescription(template.description || "");
      setTemplateTags(normalizeTemplateTags(template.tags ?? []));
      setTemplateFields(
        Array.isArray(template.fields) && template.fields.length
          ? template.fields.map(hydrateFieldFromTemplate)
          : [EMPTY_FIELD],
      );

      try {
        setLoadedTemplateSnapshot(serializeTemplatePayload(template));
      } catch {
        setLoadedTemplateSnapshot(null);
      }

      setSelectedUploadTemplateId(targetTemplateId);
      setRouteLoad({ id: targetTemplateId, status: "ready" });
    } catch (error) {
      if (isCurrent()) setRouteLoad({ id: targetTemplateId, status: error.status === 404 ? "missing" : "error" });
      // A Template that fails to load leaves the current editor state untouched.
    }
  }

  function startNewTemplateDraft({ empty = false } = {}) {
    saveRequestRef.current += 1;
    setIsSavingTemplate(false);
    setShowTemplateJsonModal(false);
    setIsJsonDraftDirty(false);
    touchDraft();
    cancelAssistant();
    setValidationFocus(null);
    cancelGeneration();
    setHasNewDraftEdits(false);
    editorRequestRef.current += 1;
    setShowDraftTemplateNav(true);
    setUpdateTemplateId("");
    setTemplateVersion(null);
    setTemplateName(empty ? "" : DEFAULT_TEMPLATE_NAME);
    setTemplateDescription(empty ? "" : DEFAULT_TEMPLATE_DESCRIPTION);
    setTemplateTags([]);
    setTemplateFields(empty ? [{ ...EMPTY_FIELD }] : copyDefaultFields());
    setLoadedTemplateSnapshot(null);
  }

  function handleTemplateNavigation() {
    const latestTemplateId = String(templates[0]?.id || "").trim();

    if (latestTemplateId) {
      void loadTemplateForEditing(latestTemplateId);
    }
  }

  useEffect(() => {
    clearWorkspaceScopedTemplates();

    if (hasApiAccess) {
      void listTemplates();
      void listTemplateTags();
    }

    return () => {
      generationRef.current += 1;
      tagListRequestRef.current?.abort();
      tagMutationRef.current?.abort();
    };
  }, [hasApiAccess, listTemplates, listTemplateTags, workspaceId, sessionId, clearWorkspaceScopedTemplates]);

  const hasUnsavedChanges =
    (isEditingTemplate ? isEditedTemplateDirty : hasNewDraftEdits) || (showTemplateJsonModal && isJsonDraftDirty);

  const routeActionsRef = useRef(null);
  routeActionsRef.current = {
    loadTemplateForEditing,
    startNewTemplateDraft,
    updateTemplateId,
    showDraftTemplateNav,
    hasUnsavedChanges,
  };
  useEffect(() => {
    if (!hasApiAccess || routeTemplateId === undefined) return;
    const actions = routeActionsRef.current;

    if (routeTemplateId === "new") {
      // Canonicalizing a draft URL must also preserve unapplied JSON edits.
      if (!actions.updateTemplateId && actions.hasUnsavedChanges) setShowDraftTemplateNav(true);
      else if (actions.updateTemplateId || !actions.showDraftTemplateNav) actions.startNewTemplateDraft();
    } else if (routeTemplateId && routeTemplateId !== actions.updateTemplateId) {
      void actions.loadTemplateForEditing(routeTemplateId);
    }

    return () => {
      editorRequestRef.current += 1;
    };
  }, [hasApiAccess, workspaceId, sessionId, routeTemplateId]);

  return {
    navigation: {
      hasUnsavedChanges,
      isDraft: showDraftTemplateNav,
      load: routeLoad,
      retry: () => loadTemplateForEditing(routeTemplateId),
      confirmDiscard: () => !hasUnsavedChanges || confirmDialog({ ...DISCARD_CHANGES }),
      invalidatePendingLoad: () => {
        editorRequestRef.current += 1;
      },
    },
    templates,
    selectedUploadTemplateId,
    setSelectedUploadTemplateId,
    contextList: {
      search: templateSearch,
      templates: contextTemplates,
      selectedTemplateId: updateTemplateId,
      isEditingTemplate,
      onSearchChange: setTemplateSearch,
      onSelectDraftTemplate: onTemplateNavigation ? () => onTemplateNavigation("new") : startNewTemplateDraft,
      onSelectTemplate: (templateId) => {
        if (onTemplateNavigation) {
          onTemplateNavigation(templateId);

          return;
        }

        onActivePageChange("templates");
        loadTemplateForEditing(templateId);
      },
    },
    templatePage: {
      templateName,
      templateDescription,
      templateTags,
      tagPickerKey: `${scope}:${updateTemplateId}`,
      tagPicker: {
        tags: workspaceTags,
        isLoading: isLoadingTags,
        error: tagListError,
        isManaging: isManagingTags,
        onReload: listTemplateTags,
        onRename: renameTemplateTag,
        onDelete: deleteTemplateTag,
      },
      onTemplateTagsChange: (tags) => {
        touchDraft();
        setHasNewDraftEdits(true);
        setTemplateTags(normalizeTemplateTags(tags));
      },
      isManagingTags,
      templateFields,
      assistant: assistant.panel,
      onOpenAssistant: assistant.open,
      validationFocus,
      isEditingTemplate,
      isSavingTemplate,
      isEditedTemplateDirty,
      hasApiAccess,
      isGeneratingTemplate: templateGeneration.modal.isOpen,
      onTemplateNameChange: (value) => {
        touchDraft();
        setHasNewDraftEdits(true);
        setTemplateName(value);
      },
      onTemplateDescriptionChange: (value) => {
        touchDraft();
        setHasNewDraftEdits(true);
        setTemplateDescription(value);
      },
      onTemplateFieldsChange: (value) => {
        touchDraft();
        setHasNewDraftEdits(true);
        setTemplateFields(value);
      },
      onAutoGenerate: () => {
        touchDraft();
        cancelAssistant();
        templateGeneration.open();
      },
      onOpenJsonModal: openTemplateJsonModal,
      onSaveTemplate: saveTemplate,
    },
    generationModal: templateGeneration.modal,
    jsonModal: {
      isOpen: showTemplateJsonModal,
      isDirty: isJsonDraftDirty,
      draft: templateJsonDraft,
      error: templateJsonError,
      diagnostics: templateJsonDiagnostics,
      copied: templateJsonCopied,
      isSavingTemplate,
      hasApiAccess,
      onDraftChange: (value) => {
        touchDraft();
        setIsJsonDraftDirty(true);
        setTemplateJsonDraft(value);
        setTemplateJsonError("");
        setTemplateJsonDiagnostics([]);
        setTemplateJsonCopied(false);
      },
      onSave: saveTemplateJsonDraft,
      onClose: closeTemplateJsonModal,
      onCopy: copyTemplateJson,
    },
    toolbar: {
      isDeletingTemplate,
      selectedTemplateId: updateTemplateId,
      onCreateTemplate: (options) => {
        const startDraft = () => {
          if (onTemplateNavigation && !onTemplateNavigation("new")) return;
          startNewTemplateDraft(options);
        };

        // Stays synchronous unless the discard prompt has to ask.
        if (onTemplateNavigation && !updateTemplateId && hasUnsavedChanges) {
          return confirmDialog({ ...DISCARD_CHANGES }).then((discard) => {
            if (discard) startDraft();
          });
        }

        startDraft();
      },
      onAutoGenerateTemplate: () => {
        touchDraft();
        cancelAssistant();
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
