import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_FIELDS = [
  {
    id: "patient_name",
    name: "Patient Name",
    description: "Full name of the patient on the prescription",
    data_type: "string",
    required: true,
  },
  {
    id: "medication_name",
    name: "Medication Name",
    description: "Name of the prescribed medication",
    data_type: "string",
    required: true,
  },
  {
    id: "dosage",
    name: "Dosage",
    description: "Strength and amount per dose (e.g. 10 mg)",
    data_type: "string",
    required: true,
  },
  {
    id: "frequency",
    name: "Frequency",
    description: "How often the medication should be taken",
    data_type: "string",
    required: true,
  },
  {
    id: "prescriber_name",
    name: "Prescriber Name",
    description: "Name of the prescribing clinician",
    data_type: "string",
    required: true,
  },
  {
    id: "prescription_lines",
    name: "Prescription Lines",
    description:
      "List each prescribed medication line when the document contains multiple medications",
    data_type: "array<object>",
    required: false,
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

const DEFAULT_OPTIONS = {
  include_confidence: true,
  include_evidence: true,
};

const DATA_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
  "array<object>",
];
const OBJECT_SCHEMA_DATA_TYPES = ["string", "number", "boolean", "date"];
const OBJECT_GUIDANCE_START = "[[OBJECT_TABLE_GUIDANCE]]";
const OBJECT_GUIDANCE_END = "[[/OBJECT_TABLE_GUIDANCE]]";
const OBJECT_SCHEMA_START = "[[OBJECT_SCHEMA]]";
const OBJECT_SCHEMA_END = "[[/OBJECT_SCHEMA]]";
const EMPTY_OBJECT_COLUMN = {
  key: "",
  heading: "",
  data_type: "string",
  description: "",
};
const INVOICE_LINES_PRESET_COLUMNS = [
  {
    key: "line_number",
    heading: "Line Number",
    data_type: "number",
    description: "Invoice line position",
  },
  {
    key: "description",
    heading: "Description",
    data_type: "string",
    description: "Line item description",
  },
  {
    key: "quantity",
    heading: "Quantity",
    data_type: "number",
    description: "Quantity for the line item",
  },
  {
    key: "unit_price",
    heading: "Unit Price",
    data_type: "number",
    description: "Price per single unit",
  },
  {
    key: "tax_rate",
    heading: "Tax Rate",
    data_type: "number",
    description: "Tax rate as decimal (for example, 0.2)",
  },
  {
    key: "line_total",
    heading: "Line Total",
    data_type: "number",
    description: "Final line total including tax",
  },
];
const EMPTY_FIELD = {
  id: "",
  name: "",
  description: "",
  data_type: "string",
  required: false,
};

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspace" },
  { id: "templates", label: "Templates" },
  { id: "documents", label: "Documents" },
];

const WORKSPACE_STORAGE_KEY = "imageextraction.workspace.v1";
const DEFAULT_TENANT_ID = "tenant_local_default";
const DEFAULT_TENANT_NAME = "Local Dev Tenant";

function loadPersistedWorkspace() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function generateApiKey() {
  return `key_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function App() {
  const initialWorkspaceRef = useRef(loadPersistedWorkspace());
  const initialWorkspace = initialWorkspaceRef.current || {};

  const [apiBase, setApiBase] = useState(initialWorkspace.apiBase || "/v1");
  const [tenantName, setTenantName] = useState(
    initialWorkspace.tenantName || DEFAULT_TENANT_NAME,
  );
  const [tenantId, setTenantId] = useState(
    initialWorkspace.tenantId || DEFAULT_TENANT_ID,
  );
  const [apiKey, setApiKey] = useState(initialWorkspace.apiKey || "");

  const [templates, setTemplates] = useState(
    Array.isArray(initialWorkspace.templates) ? initialWorkspace.templates : [],
  );
  const [templateName, setTemplateName] = useState("Prescription Template");
  const [templateDescription, setTemplateDescription] = useState(
    "Extract medication and prescription fields from a document image",
  );
  const [templateFields, setTemplateFields] = useState(DEFAULT_FIELDS);

  const [updateTemplateId, setUpdateTemplateId] = useState("");
  const [updateName, setUpdateName] = useState("");
  const [updateDescription, setUpdateDescription] = useState("");
  const [includeUpdateFields, setIncludeUpdateFields] = useState(false);
  const [updateFields, setUpdateFields] = useState([EMPTY_FIELD]);

  const [extractTemplateId, setExtractTemplateId] = useState(
    initialWorkspace.extractTemplateId || "",
  );
  const [imageFile, setImageFile] = useState(null);
  const [lastJobId, setLastJobId] = useState(initialWorkspace.lastJobId || "");

  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [latestResponse, setLatestResponse] = useState(null);

  const [activePage, setActivePage] = useState("workspace");
  const [showDevConsole, setShowDevConsole] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [queuedJobs, setQueuedJobs] = useState({});
  const [jobHistory, setJobHistory] = useState(
    Array.isArray(initialWorkspace.jobHistory)
      ? initialWorkspace.jobHistory
      : [],
  );
  const [manualJobLookupId, setManualJobLookupId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    initialWorkspace.selectedDocumentId || "",
  );

  const previewUrlsRef = useRef(new Set());

  const hasApiKey = Boolean(apiKey.trim());
  const baseUrl = useMemo(() => apiBase.replace(/\/+$/, ""), [apiBase]);
  const isEditingTemplate = Boolean(updateTemplateId.trim());

  const documents = useMemo(() => {
    const historyIds = new Set(jobHistory.map((job) => job.job_id));
    const queuedOnly = Object.entries(queuedJobs)
      .filter(([jobId]) => !historyIds.has(jobId))
      .map(([jobId, meta]) => ({
        job_id: jobId,
        status: "queued",
        template_id: meta.template_id || extractTemplateId || "",
        image_name:
          meta.image_name || defaultUploadedName(meta.source_mime_type),
        image_preview_url: meta.image_preview_url || null,
        source_mime_type: meta.source_mime_type || null,
        queued_at: meta.queued_at || null,
        updated_at: meta.queued_at || null,
        results: [],
      }));

    return [...jobHistory, ...queuedOnly].sort((a, b) => {
      const left = Date.parse(b.updated_at || b.queued_at || "") || 0;
      const right = Date.parse(a.updated_at || a.queued_at || "") || 0;
      return left - right;
    });
  }, [extractTemplateId, jobHistory, queuedJobs]);

  const selectedDocument = useMemo(() => {
    if (!documents.length) {
      return null;
    }
    if (!selectedDocumentId) {
      return documents[0];
    }
    return (
      documents.find((document) => document.job_id === selectedDocumentId) ||
      documents[0]
    );
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      previewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const payload = {
      apiBase,
      tenantName,
      tenantId,
      apiKey,
      templates,
      extractTemplateId,
      lastJobId,
      jobHistory,
      selectedDocumentId,
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [
    apiBase,
    tenantName,
    tenantId,
    apiKey,
    templates,
    extractTemplateId,
    lastJobId,
    jobHistory,
    selectedDocumentId,
  ]);

  function addLog(message) {
    const time = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${time}] ${message}`, ...prev].slice(0, 80));
  }

  function endpoint(path) {
    return `${baseUrl}${path}`;
  }

  async function request(path, options = {}, authRequired = true) {
    const headers = new Headers(options.headers || {});

    if (authRequired) {
      if (!hasApiKey) {
        throw new Error("API key is required");
      }
      headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    }

    const response = await fetch(endpoint(path), {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return null;
    }

    const rawText = await response.text();
    const data = rawText ? tryParseJson(rawText) : null;

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        rawText ||
        `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = data?.error?.code || null;
      throw error;
    }

    setLatestResponse(data ?? rawText);
    return data;
  }

  function upsertJobHistory(job) {
    if (!job?.job_id) {
      return;
    }

    const queuedMeta = queuedJobs[job.job_id] || null;
    setJobHistory((prev) => {
      const existing =
        prev.find((entry) => entry.job_id === job.job_id) || null;
      const normalized = {
        ...job,
        image_name:
          queuedMeta?.image_name ||
          existing?.image_name ||
          job.image_name ||
          null,
        image_preview_url:
          queuedMeta?.image_preview_url ||
          existing?.image_preview_url ||
          job.image_preview_url ||
          null,
        source_mime_type:
          queuedMeta?.source_mime_type ||
          existing?.source_mime_type ||
          job.source_mime_type ||
          null,
        queued_at:
          queuedMeta?.queued_at || existing?.queued_at || job.queued_at || null,
        updated_at: new Date().toISOString(),
      };
      const next = [
        normalized,
        ...prev.filter((entry) => entry.job_id !== job.job_id),
      ];
      next.sort((a, b) => {
        const left = Date.parse(b.updated_at || "") || 0;
        const right = Date.parse(a.updated_at || "") || 0;
        return left - right;
      });
      return next;
    });

    if (["completed", "failed", "retryable_failed"].includes(job.status)) {
      setQueuedJobs((prev) => {
        if (!prev[job.job_id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[job.job_id];
        return next;
      });
      setSelectedDocumentId(job.job_id);
    }
  }

  async function rotateTenantApiKey(nextApiKey, targetTenantId = tenantId) {
    const data = await request(
      `/dev/tenants/${encodeURIComponent(targetTenantId)}/api-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: nextApiKey }),
      },
      false,
    );

    setTenantId(data.tenant_id || targetTenantId);
    setApiKey(data.api_key || nextApiKey);
    addLog(`API key rotated for tenant: ${data.tenant_id || targetTenantId}`);
    return data;
  }

  async function createTenant(options = {}) {
    const targetTenantId = options.tenantId || tenantId || DEFAULT_TENANT_ID;
    const targetApiKey = options.apiKey || apiKey || generateApiKey();
    const silent = Boolean(options.silent);

    setBusy(true);
    try {
      if (!silent) {
        addLog("Ensuring dev tenant...");
      }
      const data = await request(
        "/tenants",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: targetTenantId,
            api_key: targetApiKey,
            name: tenantName || DEFAULT_TENANT_NAME,
          }),
        },
        false,
      );
      setTenantId(data.tenant_id || targetTenantId);
      setApiKey(data.api_key || targetApiKey);
      if (!silent) {
        addLog(`Tenant ready: ${data.tenant_id || targetTenantId}`);
      }
    } catch (error) {
      if (error.code === "tenant_conflict") {
        try {
          await rotateTenantApiKey(targetApiKey, targetTenantId);
        } catch (rotateError) {
          addLog(`Create tenant failed: ${rotateError.message}`);
        }
      } else {
        addLog(`Create tenant failed: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshApiKey() {
    const targetTenantId = tenantId || DEFAULT_TENANT_ID;
    const nextApiKey = generateApiKey();

    setBusy(true);
    try {
      await rotateTenantApiKey(nextApiKey, targetTenantId);
    } catch (error) {
      if (error.code === "not_found") {
        await createTenant({ tenantId: targetTenantId, apiKey: nextApiKey });
      } else {
        addLog(`Refresh API key failed: ${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (apiKey.trim()) {
      return;
    }

    const nextTenantId = tenantId || DEFAULT_TENANT_ID;
    const nextApiKey = generateApiKey();

    setTenantId(nextTenantId);
    if (!tenantName.trim()) {
      setTenantName(DEFAULT_TENANT_NAME);
    }
    void createTenant({
      tenantId: nextTenantId,
      apiKey: nextApiKey,
      silent: true,
    });
  }, []);

  useEffect(() => {
    if (!apiKey.trim()) {
      return;
    }

    void listTemplates();
  }, [apiKey]);

  async function listTemplates() {
    setBusy(true);
    try {
      const data = await request("/templates", { method: "GET" });
      const list = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      if (!extractTemplateId && list.length > 0) {
        setExtractTemplateId(list[0].id);
      }
      addLog(`Loaded ${list.length} templates`);
    } catch (error) {
      addLog(`List templates failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createTemplate() {
    setBusy(true);
    try {
      const fields = normalizeFields(templateFields);
      const data = await request("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName,
          description: templateDescription,
          fields,
        }),
      });
      addLog(`Template created: ${data.template_id}`);
      setUpdateTemplateId(data.template_id);
      setExtractTemplateId(data.template_id);
      await listTemplates();
    } catch (error) {
      addLog(`Create template failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function updateTemplate() {
    if (!updateTemplateId.trim()) {
      addLog("Update template failed: template ID is required");
      return;
    }

    const fields = normalizeFields(templateFields);

    setBusy(true);
    try {
      await request(
        `/templates/${encodeURIComponent(updateTemplateId.trim())}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName,
            description: templateDescription,
            fields,
          }),
        },
      );
      addLog(`Template updated: ${updateTemplateId.trim()}`);
      await listTemplates();
    } catch (error) {
      addLog(`Update template failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!updateTemplateId.trim()) {
      addLog("Delete template failed: template ID is required");
      return;
    }

    setBusy(true);
    try {
      await request(
        `/templates/${encodeURIComponent(updateTemplateId.trim())}`,
        {
          method: "DELETE",
        },
      );
      addLog(`Template deleted: ${updateTemplateId.trim()}`);
      startNewTemplateDraft();
      await listTemplates();
    } catch (error) {
      addLog(`Delete template failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadTemplateForEditing() {
    if (!updateTemplateId.trim()) {
      addLog("Load template failed: template ID is required");
      return;
    }

    setBusy(true);
    try {
      const template = await request(
        `/templates/${encodeURIComponent(updateTemplateId.trim())}`,
        { method: "GET" },
      );
      setTemplateName(template.name || "");
      setTemplateDescription(template.description || "");
      setTemplateFields(
        Array.isArray(template.fields) && template.fields.length
          ? template.fields.map(hydrateFieldFromTemplate)
          : [EMPTY_FIELD],
      );
      setExtractTemplateId(updateTemplateId.trim());
      addLog(`Loaded template ${updateTemplateId.trim()} for editing`);
    } catch (error) {
      addLog(`Load template failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function startNewTemplateDraft() {
    setUpdateTemplateId("");
    setTemplateName("Prescription Template");
    setTemplateDescription(
      "Extract medication and prescription fields from a document image",
    );
    setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
    addLog("Switched to new template draft");
  }

  function openUploadModal() {
    setUploadTemplateId(extractTemplateId || templates[0]?.id || "");
    setUploadFile(null);
    setShowUploadModal(true);
  }

  function closeUploadModal() {
    if (busy) {
      return;
    }
    setShowUploadModal(false);
  }

  async function uploadFromModal() {
    if (!uploadTemplateId.trim()) {
      addLog("Upload failed: select a template");
      return;
    }
    if (!uploadFile) {
      addLog("Upload failed: choose a document file (image or PDF)");
      return;
    }

    setShowUploadModal(false);
    setExtractTemplateId(uploadTemplateId.trim());
    setImageFile(uploadFile);
    setActivePage("documents");
    await runExtractWithInputs(uploadTemplateId.trim(), uploadFile);
  }

  async function runExtractWithInputs(templateId, file) {
    if (!templateId.trim()) {
      addLog("Extract failed: template ID is required");
      return;
    }
    if (!file) {
      addLog("Extract failed: choose a document file (image or PDF)");
      return;
    }

    const imagePreviewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null;
    if (imagePreviewUrl) {
      previewUrlsRef.current.add(imagePreviewUrl);
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("template_id", templateId.trim());
      formData.append("image", file);
      formData.append("options", JSON.stringify(DEFAULT_OPTIONS));

      const queued = await request("/extract", {
        method: "POST",
        body: formData,
      });

      const jobId = queued.job_id;
      setLastJobId(jobId);
      setQueuedJobs((prev) => ({
        ...prev,
        [jobId]: {
          queued_at: new Date().toISOString(),
          image_name: file.name,
          image_preview_url: imagePreviewUrl,
          source_mime_type: file.type || null,
          template_id: templateId.trim(),
        },
      }));
      setSelectedDocumentId(jobId);
      addLog(`Job queued: ${jobId}`);

      const finalJob = await pollJobUntilFinished(jobId);
      setLatestResponse(finalJob);
      upsertJobHistory(finalJob);
      if (
        finalJob.status === "failed" ||
        finalJob.status === "retryable_failed"
      ) {
        addLog(
          `Job finished with status: ${finalJob.status} (${finalJob.error_code || "unknown"}: ${finalJob.error_message || "no message"})`,
        );
      } else {
        addLog(`Job finished with status: ${finalJob.status}`);
      }
      setActivePage("documents");
    } catch (error) {
      addLog(`Extract failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runExtract() {
    await runExtractWithInputs(extractTemplateId, imageFile);
  }

  async function pollLatestJob() {
    if (!lastJobId.trim()) {
      addLog("No job to poll");
      return;
    }

    setBusy(true);
    try {
      const data = await request(
        `/jobs/${encodeURIComponent(lastJobId.trim())}`,
        {
          method: "GET",
        },
      );
      setLatestResponse(data);
      upsertJobHistory(data);
      if (data.status === "failed" || data.status === "retryable_failed") {
        addLog(
          `Polled job ${lastJobId.trim()}: ${data.status} (${data.error_code || "unknown"}: ${data.error_message || "no message"})`,
        );
      } else {
        addLog(`Polled job ${lastJobId.trim()}: ${data.status}`);
      }
    } catch (error) {
      addLog(`Poll failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function lookupJobById() {
    if (!manualJobLookupId.trim()) {
      addLog("Lookup failed: enter a job ID");
      return;
    }

    setBusy(true);
    try {
      const data = await request(
        `/jobs/${encodeURIComponent(manualJobLookupId.trim())}`,
        {
          method: "GET",
        },
      );
      upsertJobHistory(data);
      if (data.status === "failed" || data.status === "retryable_failed") {
        addLog(
          `Loaded job ${manualJobLookupId.trim()}: ${data.status} (${data.error_code || "unknown"}: ${data.error_message || "no message"})`,
        );
      } else {
        addLog(`Loaded job ${manualJobLookupId.trim()}: ${data.status}`);
      }
      setManualJobLookupId("");
    } catch (error) {
      addLog(`Lookup failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resetEnvironment() {
    setBusy(true);
    try {
      await request(
        "/dev/reset",
        {
          method: "POST",
        },
        false,
      );

      const nextTenantId = DEFAULT_TENANT_ID;
      const nextApiKey = generateApiKey();
      setTenantId(nextTenantId);
      setApiKey(nextApiKey);
      setTenantName(DEFAULT_TENANT_NAME);
      setTemplates([]);
      setUpdateTemplateId("");
      setExtractTemplateId("");
      setLastJobId("");
      setLatestResponse(null);
      setQueuedJobs({});
      setJobHistory([]);
      setSelectedDocumentId("");
      addLog("Dev environment reset complete");
      await createTenant({
        tenantId: nextTenantId,
        apiKey: nextApiKey,
        silent: true,
      });
    } catch (error) {
      addLog(`Reset failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function pollJobUntilFinished(jobId) {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const data = await request(`/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
      });
      upsertJobHistory(data);
      if (["completed", "failed", "retryable_failed"].includes(data.status)) {
        return data;
      }
      addLog(`Polling job ${jobId} (${attempt}/30): ${data.status}`);
      await sleep(2000);
    }
    throw new Error("Timed out waiting for job completion");
  }

  if (showDevConsole) {
    return (
      <div className="page-shell">
        <header className="hero">
          <h1>Data Extraction Dev Console</h1>
          <p>Legacy one-page UI kept for low-level API testing.</p>
          <div className="actions">
            <button type="button" onClick={() => setShowDevConsole(false)}>
              Back to Workflow App
            </button>
          </div>
        </header>

        <section className="panel">
          <h2>API Config</h2>
          <div className="row">
            <label>
              API base
              <input
                value={apiBase}
                onChange={(event) => setApiBase(event.target.value)}
                placeholder="/v1"
              />
            </label>
          </div>
          <div className="row two-up">
            <label>
              Tenant name
              <input
                value={tenantName}
                onChange={(event) => setTenantName(event.target.value)}
              />
            </label>
            <label>
              API key
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Bearer token"
              />
            </label>
          </div>
          <div className="actions">
            <button disabled={busy} onClick={refreshApiKey}>
              Refresh API Key
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={resetEnvironment}
            >
              Reset Dev Data
            </button>
          </div>
          <p className="muted">Tenant ID: {tenantId || "not set"}</p>
        </section>

        <section className="panel">
          <h2>Templates</h2>
          <div className="row two-up">
            <label>
              Name
              <input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </label>
            <label>
              Description
              <input
                value={templateDescription}
                onChange={(event) => setTemplateDescription(event.target.value)}
              />
            </label>
          </div>
          <FieldEditor
            fields={templateFields}
            onChange={setTemplateFields}
            title="Fields"
            subtitle="Add, edit, and remove fields. The form is converted to JSON in the API request."
          />
          <div className="actions">
            <button disabled={busy || !hasApiKey} onClick={createTemplate}>
              Create Template
            </button>
            <button disabled={busy || !hasApiKey} onClick={listTemplates}>
              Refresh Templates
            </button>
          </div>

          <div className="row three-up">
            <label>
              Template
              <select
                value={updateTemplateId}
                onChange={(event) => setUpdateTemplateId(event.target.value)}
              >
                <option value="">Select template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              New name (optional)
              <input
                value={updateName}
                onChange={(event) => setUpdateName(event.target.value)}
              />
            </label>
            <label>
              New description (optional)
              <input
                value={updateDescription}
                onChange={(event) => setUpdateDescription(event.target.value)}
              />
            </label>
          </div>
          <div className="actions compact">
            <button
              type="button"
              disabled={busy || !hasApiKey}
              onClick={loadTemplateForEditing}
            >
              Load Template Fields
            </button>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={includeUpdateFields}
                onChange={(event) =>
                  setIncludeUpdateFields(event.target.checked)
                }
              />
              Update fields
            </label>
          </div>
          {includeUpdateFields ? (
            <FieldEditor
              fields={updateFields}
              onChange={setUpdateFields}
              title="New Fields"
              subtitle="When enabled, these fields replace the current template version."
            />
          ) : (
            <p className="muted">
              Field update disabled. Existing fields stay unchanged.
            </p>
          )}
          <div className="actions">
            <button disabled={busy || !hasApiKey} onClick={updateTemplate}>
              Update Template
            </button>
            <button
              className="danger"
              disabled={busy || !hasApiKey}
              onClick={deleteTemplate}
            >
              Delete Template
            </button>
          </div>

          <p className="muted">
            {templates.length
              ? `${templates.length} templates loaded`
              : "No templates loaded yet"}
          </p>
        </section>

        <section className="panel">
          <h2>Extraction</h2>
          <div className="row two-up">
            <label>
              Template ID
              <input
                value={extractTemplateId}
                onChange={(event) => setExtractTemplateId(event.target.value)}
              />
            </label>
            <label>
              Document file
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(event) =>
                  setImageFile(event.target.files?.[0] || null)
                }
              />
            </label>
          </div>
          <div className="actions">
            <button disabled={busy || !hasApiKey} onClick={runExtract}>
              Upload + Run Extract
            </button>
            <button disabled={busy || !hasApiKey} onClick={pollLatestJob}>
              Poll Last Job
            </button>
          </div>
          <p className="muted">Last job ID: {lastJobId || "none"}</p>
        </section>

        <section className="panel">
          <h2>Latest Response</h2>
          <LatestResponseCard response={latestResponse} />
        </section>

        <section className="panel">
          <h2>Log</h2>
          <pre className="log-block">
            {logLines.length ? logLines.join("\n") : "No activity yet"}
          </pre>
        </section>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <aside className="left-sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">Data Extraction</p>
          <h1>Studio</h1>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === activePage ? "sidebar-link active" : "sidebar-link"
              }
              onClick={() => setActivePage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar-upload-button"
          disabled={busy || !hasApiKey}
          onClick={openUploadModal}
        >
          Upload Document
        </button>

        <div className="sidebar-spacer" aria-hidden="true" />

        <div className="sidebar-footer">
          <button type="button" onClick={() => setShowDevConsole(true)}>
            Open Dev Console
          </button>
        </div>
      </aside>

      <main className="main-content">
        {activePage === "workspace" ? (
          <>
            <header className="page-header">
              <p className="eyebrow">Workspace</p>
              <h2>Environment and Access</h2>
              <p>
                Manage API connection details, tenant credentials, and workspace
                state from one place.
              </p>
            </header>

            <section className="content-grid workspace-page-grid">
              <article className="workspace-card">
                <div className="workspace-head">
                  <h2>Connection Settings</h2>
                  <p>Configure your local API endpoint and tenant details.</p>
                </div>
                <div className="row two-up">
                  <label>
                    API base
                    <input
                      value={apiBase}
                      onChange={(event) => setApiBase(event.target.value)}
                      placeholder="/v1"
                    />
                  </label>
                  <label>
                    Tenant name
                    <input
                      value={tenantName}
                      onChange={(event) => setTenantName(event.target.value)}
                    />
                  </label>
                </div>
                <label>
                  API key
                  <input
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Bearer token"
                  />
                </label>
                <div className="actions">
                  <button type="button" disabled={busy} onClick={refreshApiKey}>
                    Refresh API Key
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !hasApiKey}
                    onClick={listTemplates}
                  >
                    Refresh Templates
                  </button>
                </div>
              </article>

              <article className="workspace-card">
                <div className="workspace-head">
                  <h2>Workspace Status</h2>
                  <p>Quick health indicators for your current session.</p>
                </div>
                <div className="status-strip">
                  <span
                    className={`status-chip ${hasApiKey ? "good" : "warn"}`}
                  >
                    API {hasApiKey ? "ready" : "required"}
                  </span>
                  <span className="status-chip">
                    Templates {templates.length}
                  </span>
                  <span className="status-chip">
                    Documents {documents.length}
                  </span>
                </div>
                <p className="muted">
                  Tenant ID: {tenantId || DEFAULT_TENANT_ID}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={resetEnvironment}
                  >
                    Reset Dev Data
                  </button>
                </div>
              </article>
            </section>
          </>
        ) : null}

        {activePage === "templates" ? (
          <>
            <header className="page-header">
              <p className="eyebrow">Templates</p>
              <h2>Template Builder</h2>
              <p>
                Build reusable extraction schemas and update existing templates
                with live field editing.
              </p>
            </header>

            <section className="content-grid templates-grid">
              <article className="workspace-card create-template-panel">
                <div className="workspace-head">
                  <h2>
                    {isEditingTemplate ? "Edit Template" : "Create Template"}
                  </h2>
                  <p>
                    {isEditingTemplate
                      ? "Loaded template is now editable below."
                      : "Start a new extraction schema or load one to edit."}
                  </p>
                </div>

                <div className="row two-up">
                  <label>
                    Load existing template
                    <select
                      value={updateTemplateId}
                      onChange={(event) =>
                        setUpdateTemplateId(event.target.value)
                      }
                    >
                      <option value="">Start new template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="template-mode-actions">
                    <p className="muted">
                      {isEditingTemplate
                        ? `Editing ${updateTemplateId}`
                        : "No template loaded"}
                    </p>
                    <div className="actions compact">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !hasApiKey || !updateTemplateId}
                        onClick={loadTemplateForEditing}
                      >
                        Load Selected
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={startNewTemplateDraft}
                      >
                        New Template
                      </button>
                    </div>
                  </div>
                </div>

                <div className="row two-up">
                  <label>
                    Name
                    <input
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                    />
                  </label>
                  <label>
                    Description
                    <input
                      value={templateDescription}
                      onChange={(event) =>
                        setTemplateDescription(event.target.value)
                      }
                    />
                  </label>
                </div>
                <FieldEditor
                  fields={templateFields}
                  onChange={setTemplateFields}
                  title="Field Designer"
                  subtitle="Move through fields quickly on the left and edit details on the right."
                />
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy || !hasApiKey}
                    onClick={
                      isEditingTemplate ? updateTemplate : createTemplate
                    }
                  >
                    {isEditingTemplate ? "Save Changes" : "Save New Template"}
                  </button>
                  {isEditingTemplate ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={busy || !hasApiKey}
                      onClick={deleteTemplate}
                    >
                      Delete Template
                    </button>
                  ) : null}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {activePage === "documents" ? (
          <>
            <header className="page-header">
              <p className="eyebrow">Documents</p>
              <h2>Upload and Review</h2>
              <p>
                Inspect extraction jobs and review results from previously
                uploaded files.
              </p>
            </header>

            <section className="content-grid documents-grid">
              <article className="workspace-card document-list-panel">
                <div className="workspace-head">
                  <h2>Uploaded Documents</h2>
                  <p>All queued and completed uploads appear here.</p>
                </div>
                {!documents.length ? (
                  <p className="muted">No documents uploaded yet.</p>
                ) : (
                  <div className="job-list document-list-scroll">
                    {documents.map((job) => (
                      <button
                        type="button"
                        key={job.job_id}
                        className={
                          selectedDocument?.job_id === job.job_id
                            ? "job-item active"
                            : "job-item"
                        }
                        onClick={() => setSelectedDocumentId(job.job_id)}
                      >
                        <div>
                          <strong>
                            {job.image_name ||
                              defaultUploadedName(job.source_mime_type)}
                          </strong>
                          <p>{job.job_id}</p>
                        </div>
                        <span
                          className={`status-pill ${statusTone(job.status)}`}
                        >
                          {job.status}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </article>

              <article className="workspace-card activity-log-panel">
                <div className="workspace-head">
                  <h2>Activity Log</h2>
                  <p>Recent API activity and workflow actions.</p>
                </div>
                <pre className="log-block">
                  {logLines.length ? logLines.join("\n") : "No activity yet"}
                </pre>
              </article>

              <article className="workspace-card result-view">
                <div className="workspace-head">
                  <h2>Document Details</h2>
                  <p>Review extraction output for the selected upload.</p>
                </div>
                {selectedDocument ? (
                  <ResultViewer job={selectedDocument} />
                ) : (
                  <p className="muted">Select an uploaded document.</p>
                )}
              </article>
            </section>
          </>
        ) : null}
      </main>

      {showUploadModal ? (
        <div className="modal-backdrop" onClick={closeUploadModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Upload document"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="workspace-head">
              <h2>Upload Document</h2>
              <p>Select a template and file, then queue extraction.</p>
            </div>
            <div className="row">
              <label>
                Template
                <select
                  value={uploadTemplateId}
                  onChange={(event) => setUploadTemplateId(event.target.value)}
                >
                  <option value="">Select template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Document file
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(event) =>
                    setUploadFile(event.target.files?.[0] || null)
                  }
                />
              </label>
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={closeUploadModal}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !hasApiKey}
                onClick={uploadFromModal}
              >
                Upload and Open Documents
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function statusTone(status) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "retryable_failed") return "bad";
  return "pending";
}

function defaultUploadedName(sourceMimeType) {
  if (
    typeof sourceMimeType === "string" &&
    sourceMimeType.startsWith("image/")
  ) {
    return "Uploaded image";
  }
  if (sourceMimeType === "application/pdf") {
    return "Uploaded document";
  }
  return "Uploaded file";
}

function ResultViewer({ job }) {
  const rows = useMemo(() => {
    if (!Array.isArray(job.results)) {
      return [];
    }

    const withIndex = job.results.map((result, index) => ({ result, index }));
    withIndex.sort((left, right) => {
      const leftArrayObject =
        left.result?.data_type === "array<object>" ? 1 : 0;
      const rightArrayObject =
        right.result?.data_type === "array<object>" ? 1 : 0;
      if (leftArrayObject !== rightArrayObject) {
        return leftArrayObject - rightArrayObject;
      }
      return left.index - right.index;
    });

    return withIndex.map((entry) => entry.result);
  }, [job.results]);

  return (
    <div className="result-stack">
      <div className="job-summary">
        <div>
          <p>
            <strong>Job:</strong> {job.job_id}
          </p>
          <p>
            <strong>Status:</strong> {job.status}
          </p>
          <p>
            <strong>Template:</strong> {job.template_id || "unknown"}
          </p>
        </div>
      </div>

      {job.status !== "completed" ? (
        <p className="muted">
          This job is not completed yet. Poll again shortly.
        </p>
      ) : null}

      {rows.length ? (
        <div className="result-cards">
          {rows.map((result) => (
            <article
              key={result.field_id}
              className={
                result.data_type === "array<object>"
                  ? "result-card result-card-wide"
                  : "result-card"
              }
            >
              <header>
                <h3>{result.name}</h3>
                <div className="result-card-badges">
                  <span className={`status-pill ${statusTone(result.status)}`}>
                    {result.status}
                  </span>
                  {typeof result.confidence === "number" ? (
                    <span
                      className={`status-pill ${confidenceTone(result.confidence)}`}
                    >
                      Confidence {(result.confidence * 100).toFixed(1)}%
                    </span>
                  ) : null}
                </div>
              </header>
              <div className="result-card-answer">
                {renderAnswer(result.answer)}
              </div>
              {result.evidence ? (
                <div className="result-card-foot">
                  {result.evidence ? (
                    <p className="hint">Evidence: {result.evidence}</p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No result rows available yet.</p>
      )}
    </div>
  );
}

function renderAnswer(answer) {
  if (answer === null || answer === undefined) {
    return <p className="muted">No value extracted.</p>;
  }

  if (isTableAnswer(answer)) {
    const columns = answer.columns.map((column, index) => {
      if (typeof column === "string") {
        return { key: column, heading: column, index };
      }
      return {
        key: column.key || String(index),
        heading: column.heading || column.key || `Column ${index + 1}`,
        index,
      };
    });

    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {answer.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={`${column.key}-${rowIndex}`}>
                    {formatAnswerValue(row?.[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (typeof answer === "object") {
    const entries = Object.entries(answer);
    if (!entries.length) {
      return <p className="muted">No values returned.</p>;
    }

    return (
      <div className="kv-list">
        {entries.map(([key, value]) => (
          <div className="kv-row" key={key}>
            <span className="kv-key">{key}</span>
            <span className="kv-value">{formatAnswerValue(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <p className="answer-text">{String(answer)}</p>;
}

function formatAnswerValue(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function isTableAnswer(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows)
  );
}

function confidenceTone(confidence) {
  const percent = confidence * 100;
  if (percent > 90) {
    return "good";
  }
  if (percent >= 80) {
    return "pending";
  }
  return "bad";
}

function FieldEditor({ fields, onChange, title, subtitle }) {
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);

  useEffect(() => {
    if (!fields.length) {
      setActiveFieldIndex(0);
      return;
    }

    if (activeFieldIndex > fields.length - 1) {
      setActiveFieldIndex(fields.length - 1);
    }
  }, [activeFieldIndex, fields.length]);

  function addField() {
    onChange((prev) => [...prev, { ...EMPTY_FIELD }]);
    setActiveFieldIndex(fields.length);
  }

  function moveField(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) {
      return;
    }

    onChange((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setActiveFieldIndex(targetIndex);
  }

  function updateField(index, key, value) {
    onChange((prev) =>
      prev.map((field, i) => {
        if (i !== index) {
          return field;
        }

        if (key === "name") {
          const sanitizedName = sanitizeFieldName(value);
          return {
            ...field,
            name: sanitizedName,
            id: toFieldId(sanitizedName),
          };
        }

        if (key === "data_type") {
          const normalizedDataType = normalizeDataType(value) || "string";
          const next = { ...field, [key]: normalizedDataType };
          if (isObjectLikeType(normalizedDataType)) {
            next.object_schema = normalizeObjectSchema(field.object_schema);
          } else {
            delete next.object_schema;
          }
          return next;
        }

        return { ...field, [key]: value };
      }),
    );
  }

  function updateObjectSchema(index, updater) {
    onChange((prev) =>
      prev.map((field, i) => {
        if (i !== index) {
          return field;
        }
        const nextSchema = updater(normalizeObjectSchema(field.object_schema));
        return { ...field, object_schema: nextSchema };
      }),
    );
  }

  function addObjectColumn(index) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: [...schema.columns, { ...EMPTY_OBJECT_COLUMN }],
    }));
  }

  function updateObjectColumn(index, columnIndex, key, value) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: schema.columns.map((column, i) =>
        i === columnIndex ? { ...column, [key]: value } : column,
      ),
    }));
  }

  function removeObjectColumn(index, columnIndex) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: schema.columns.filter((_, i) => i !== columnIndex),
    }));
  }

  function moveObjectColumn(index, columnIndex, direction) {
    updateObjectSchema(index, (schema) => {
      const targetIndex = columnIndex + direction;
      if (targetIndex < 0 || targetIndex >= schema.columns.length) {
        return schema;
      }

      const nextColumns = [...schema.columns];
      const [moved] = nextColumns.splice(columnIndex, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return {
        ...schema,
        columns: nextColumns,
      };
    });
  }

  function applyInvoiceLinesPreset(index) {
    updateObjectSchema(index, (schema) => ({
      ...schema,
      columns: INVOICE_LINES_PRESET_COLUMNS.map((column) => ({ ...column })),
    }));
  }

  function removeField(index) {
    onChange((prev) => prev.filter((_, i) => i !== index));
  }

  function duplicateField(index) {
    const source = fields[index];
    if (!source) {
      return;
    }

    const copyName = source.name ? `${source.name} Copy` : "";

    const copy = {
      ...source,
      id: toFieldId(copyName),
      name: copyName,
      object_schema: source.object_schema
        ? normalizeObjectSchema(source.object_schema)
        : undefined,
    };

    onChange((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setActiveFieldIndex(index + 1);
  }

  const activeField = fields[activeFieldIndex] || null;
  const completeFields = fields.filter((field) => {
    return Boolean(
      String(field.id || "").trim() &&
      String(field.name || "").trim() &&
      String(field.description || "").trim(),
    );
  }).length;
  const objectColumns = activeField
    ? normalizeObjectSchema(activeField.object_schema).columns
    : [];

  return (
    <div className="field-editor">
      <div className="field-editor-head">
        <div>
          <h3>{title}</h3>
          <p className="hint">{subtitle}</p>
        </div>
        <div className="field-editor-meta">
          <span className="status-chip">Fields {fields.length}</span>
          <span className="status-chip good">
            Ready {completeFields}/{fields.length}
          </span>
          <button type="button" onClick={addField}>
            Add Field
          </button>
        </div>
      </div>
      {fields.length === 0 ? (
        <p className="muted">No fields yet. Add at least one.</p>
      ) : (
        <div className="field-studio">
          <aside className="field-nav">
            {fields.map((field, index) => (
              <button
                key={`${field.id || "field"}-${index}`}
                type="button"
                className={
                  index === activeFieldIndex
                    ? "field-nav-item active"
                    : "field-nav-item"
                }
                onClick={() => setActiveFieldIndex(index)}
              >
                <div className="field-nav-top">
                  <strong>{field.name || `Field ${index + 1}`}</strong>
                  <span className="status-pill pending">{field.data_type}</span>
                </div>
                <span>{field.id || "ID auto-generated from name"}</span>
                <div className="field-nav-flags">
                  {field.required ? (
                    <span className="status-chip good">Required</span>
                  ) : (
                    <span className="status-chip">Optional</span>
                  )}
                  {isObjectLikeType(field.data_type) ? (
                    <span className="status-chip">Object schema</span>
                  ) : null}
                </div>
              </button>
            ))}
          </aside>

          {activeField ? (
            <div className="field-detail">
              <div className="field-detail-head">
                <div>
                  <h4>
                    Field {activeFieldIndex + 1} of {fields.length}
                  </h4>
                  <p className="muted">
                    Configure extraction behavior and response shape.
                  </p>
                </div>
                <div className="actions compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveField(activeFieldIndex, -1)}
                    disabled={activeFieldIndex === 0}
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveField(activeFieldIndex, 1)}
                    disabled={activeFieldIndex === fields.length - 1}
                  >
                    Move Down
                  </button>
                </div>
              </div>

              <div className="row three-up">
                <label>
                  Field ID
                  <input
                    value={activeField.id}
                    readOnly
                    placeholder="auto_generated_from_name"
                  />
                </label>
                <label>
                  Name
                  <input
                    value={activeField.name}
                    onChange={(event) =>
                      updateField(activeFieldIndex, "name", event.target.value)
                    }
                    placeholder="Medication Name"
                  />
                </label>
                <label>
                  Type
                  <select
                    value={activeField.data_type}
                    onChange={(event) =>
                      updateField(
                        activeFieldIndex,
                        "data_type",
                        event.target.value,
                      )
                    }
                  >
                    {DATA_TYPES.map((dataType) => (
                      <option key={dataType} value={dataType}>
                        {dataType}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Description
                <textarea
                  value={activeField.description}
                  onChange={(event) =>
                    updateField(
                      activeFieldIndex,
                      "description",
                      event.target.value,
                    )
                  }
                  placeholder="Describe what should be extracted"
                />
              </label>

              <div className="field-controls">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={Boolean(activeField.required)}
                    onChange={(event) =>
                      updateField(
                        activeFieldIndex,
                        "required",
                        event.target.checked,
                      )
                    }
                  />
                  Required field
                </label>
                <div className="actions compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => duplicateField(activeFieldIndex)}
                  >
                    Duplicate
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => removeField(activeFieldIndex)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {isObjectLikeType(activeField.data_type) ? (
                <div className="object-schema-editor">
                  <div className="object-schema-head">
                    <div>
                      <strong>Object Schema Builder</strong>
                      <p className="hint">
                        Define output columns and ordering for table-style
                        object extraction.
                      </p>
                    </div>
                    <div className="actions compact">
                      <button
                        type="button"
                        onClick={() => addObjectColumn(activeFieldIndex)}
                      >
                        Add Column
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          applyInvoiceLinesPreset(activeFieldIndex)
                        }
                      >
                        Apply Invoice Preset
                      </button>
                    </div>
                  </div>
                  {!objectColumns.length ? (
                    <p className="muted">
                      No columns yet. Add one to start defining the object
                      shape.
                    </p>
                  ) : (
                    <div className="object-column-list">
                      {objectColumns.map((column, columnIndex) => (
                        <div className="object-column-card" key={columnIndex}>
                          <p className="hint object-column-index">
                            Column {columnIndex + 1}
                          </p>
                          <div className="row object-columns-grid">
                            <label>
                              Key
                              <input
                                value={column.key}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "key",
                                    event.target.value,
                                  )
                                }
                                placeholder="line_total"
                              />
                            </label>
                            <label>
                              Heading
                              <input
                                value={column.heading}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "heading",
                                    event.target.value,
                                  )
                                }
                                placeholder="Line Total"
                              />
                            </label>
                            <label>
                              Type
                              <select
                                value={column.data_type}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "data_type",
                                    event.target.value,
                                  )
                                }
                              >
                                {OBJECT_SCHEMA_DATA_TYPES.map((dataType) => (
                                  <option key={dataType} value={dataType}>
                                    {dataType}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Column Description
                              <input
                                value={column.description}
                                onChange={(event) =>
                                  updateObjectColumn(
                                    activeFieldIndex,
                                    columnIndex,
                                    "description",
                                    event.target.value,
                                  )
                                }
                                placeholder="What this column contains"
                              />
                            </label>
                          </div>
                          <div className="actions compact">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                moveObjectColumn(
                                  activeFieldIndex,
                                  columnIndex,
                                  -1,
                                )
                              }
                              disabled={columnIndex === 0}
                            >
                              Move Up
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                moveObjectColumn(
                                  activeFieldIndex,
                                  columnIndex,
                                  1,
                                )
                              }
                              disabled={
                                columnIndex === objectColumns.length - 1
                              }
                            >
                              Move Down
                            </button>
                            <button
                              className="danger"
                              type="button"
                              onClick={() =>
                                removeObjectColumn(
                                  activeFieldIndex,
                                  columnIndex,
                                )
                              }
                            >
                              Remove Column
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function LatestResponseCard({ response }) {
  if (!response) {
    return <p className="muted">No response yet.</p>;
  }

  if (typeof response !== "object") {
    return <p className="answer-text">{String(response)}</p>;
  }

  const templateCount = Array.isArray(response.templates)
    ? response.templates.length
    : null;
  const hasJob = Boolean(response.job_id);
  const hasTenant = Boolean(response.tenant_id);

  return (
    <div className="response-card">
      <div className="response-badges">
        {hasJob ? <span className="status-chip good">Job response</span> : null}
        {hasTenant ? (
          <span className="status-chip good">Tenant response</span>
        ) : null}
        {templateCount !== null ? (
          <span className="status-chip">Templates {templateCount}</span>
        ) : null}
      </div>

      {response.job_id ? (
        <p>
          <strong>Job ID:</strong> {response.job_id}
        </p>
      ) : null}
      {response.status ? (
        <p>
          <strong>Status:</strong> {response.status}
        </p>
      ) : null}
      {response.template_id ? (
        <p>
          <strong>Template:</strong> {response.template_id}
        </p>
      ) : null}
      {response.tenant_id ? (
        <p>
          <strong>Tenant:</strong> {response.tenant_id}
        </p>
      ) : null}

      {Array.isArray(response.templates) && response.templates.length ? (
        <div className="template-summary-list">
          {response.templates.slice(0, 4).map((template) => (
            <div
              className="template-summary-item"
              key={template.id || template.name}
            >
              <strong>{template.name || "Untitled template"}</strong>
              <span>{template.id || "No ID"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Add at least one field");
  }

  const ids = new Set();
  const names = new Set();

  return fields.map((field, index) => {
    const name = normalizeFieldName(field.name);
    const id = toFieldId(name);
    const description = String(field.description || "").trim();
    const dataType = normalizeDataType(field.data_type);
    const required = Boolean(field.required);
    const { baseDescription } = extractObjectMetadata(description);
    const objectSchema = isObjectLikeType(dataType)
      ? normalizeObjectSchema(field.object_schema)
      : null;

    if (!name) {
      throw new Error(`Field ${index + 1}: name is required`);
    }
    if (!id) {
      throw new Error(
        `Field ${index + 1}: name must include letters or numbers`,
      );
    }
    if (!baseDescription) {
      throw new Error(`Field ${index + 1}: description is required`);
    }
    if (!DATA_TYPES.includes(dataType)) {
      throw new Error(`Field ${index + 1}: unsupported type \"${dataType}\"`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate field ID: ${id}`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate field name: ${name}`);
    }

    ids.add(id);
    names.add(name);

    const objectColumns = objectSchema
      ? validateObjectColumns(objectSchema.columns, index)
      : null;
    const finalDescription = objectColumns
      ? appendObjectMetadata(baseDescription, objectColumns, dataType)
      : baseDescription;

    return {
      id,
      name,
      description: finalDescription,
      data_type: dataType,
      required,
    };
  });
}

function isObjectLikeType(dataType) {
  const normalized = normalizeDataType(dataType);
  return normalized === "object" || normalized === "array<object>";
}

function normalizeDataType(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^array\s*<\s*object\s*>$/i.test(raw)) {
    return "array<object>";
  }

  const lowered = raw.toLowerCase();
  if (DATA_TYPES.includes(lowered)) {
    return lowered;
  }

  return raw;
}

function sanitizeFieldName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9 ]+/g, "");
}

function normalizeFieldName(value) {
  return sanitizeFieldName(value).trim().replace(/\s+/g, " ");
}

function toFieldId(name) {
  return normalizeFieldName(name).toLowerCase().replace(/\s+/g, "_");
}

function normalizeObjectSchema(schema) {
  const rawColumns = Array.isArray(schema?.columns) ? schema.columns : [];
  const columns = rawColumns.map((column) => ({
    key: String(column?.key || ""),
    heading: String(column?.heading || ""),
    data_type: OBJECT_SCHEMA_DATA_TYPES.includes(
      String(column?.data_type || ""),
    )
      ? String(column.data_type)
      : "string",
    description: String(column?.description || ""),
  }));

  return {
    mode: "table",
    columns,
  };
}

function validateObjectColumns(columns, fieldIndex) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(
      `Field ${fieldIndex + 1}: object fields require at least one table column`,
    );
  }

  const keys = new Set();
  const normalized = columns.map((column, columnIndex) => {
    const key = String(column.key || "").trim();
    const heading = String(column.heading || "").trim();
    const description = String(column.description || "").trim();
    const dataType = String(column.data_type || "").trim();

    if (!key) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: key is required`,
      );
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: key must be letters, numbers, and underscores`,
      );
    }
    if (!heading) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading is required`,
      );
    }
    if (!OBJECT_SCHEMA_DATA_TYPES.includes(dataType)) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: unsupported column type`,
      );
    }
    if (keys.has(key)) {
      throw new Error(
        `Field ${fieldIndex + 1}: duplicate object column key "${key}"`,
      );
    }

    keys.add(key);

    return {
      key,
      heading,
      data_type: dataType,
      description,
    };
  });

  return normalized;
}

function appendObjectMetadata(baseDescription, columns, dataType) {
  const schema = {
    mode: "table",
    data_type: dataType,
    columns,
  };

  const compactColumns = columns.map((column) => ({
    key: column.key,
    heading: column.heading,
    type: column.data_type,
  }));

  const guidance = [
    "Return this field in table form with `columns` and `rows`.",
    "Use `columns` as the heading list in order.",
    "Use `rows` as objects that include every column key.",
    "If a row value is missing, set the value to null.",
    "Preserve row order from the source document.",
    `Expected columns: ${JSON.stringify(compactColumns)}`,
  ].join(" ");

  return [
    baseDescription,
    "",
    OBJECT_GUIDANCE_START,
    guidance,
    OBJECT_GUIDANCE_END,
    "",
    OBJECT_SCHEMA_START,
    JSON.stringify(schema),
    OBJECT_SCHEMA_END,
  ].join("\n");
}

function extractObjectMetadata(description) {
  const raw = String(description || "");
  const schemaPattern =
    /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/;
  const guidancePattern =
    /\[\[OBJECT_TABLE_GUIDANCE\]\][\s\S]*?\[\[\/OBJECT_TABLE_GUIDANCE\]\]\s*/g;

  const schemaMatch = raw.match(schemaPattern);
  let objectSchema = null;

  if (schemaMatch?.[1]) {
    try {
      const parsed = JSON.parse(schemaMatch[1]);
      objectSchema = normalizeObjectSchema(parsed);
    } catch {
      objectSchema = null;
    }
  }

  const baseDescription = raw
    .replace(schemaPattern, "")
    .replace(guidancePattern, "")
    .trim();

  return {
    baseDescription,
    objectSchema,
  };
}

function hydrateFieldFromTemplate(field) {
  const { baseDescription, objectSchema } = extractObjectMetadata(
    field.description,
  );
  const sanitizedName = normalizeFieldName(field.name);
  const normalizedDataType = normalizeDataType(field.data_type);

  return {
    ...field,
    id: toFieldId(sanitizedName),
    name: sanitizedName,
    description: baseDescription,
    data_type: normalizedDataType || "string",
    required: Boolean(field.required),
    ...(objectSchema ? { object_schema: objectSchema } : {}),
  };
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
