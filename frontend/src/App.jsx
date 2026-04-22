import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRuntimeAuthClient } from "./lib/authClient";

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
  { id: "workspace", label: "Workspaces", icon: "WS" },
  { id: "templates", label: "Templates", icon: "TP" },
  { id: "documents", label: "Documents", icon: "DC" },
];

const WORKSPACE_STORAGE_KEY = "imageextraction.workspace.v1";
const DEFAULT_WORKSPACE_ID = "workspace_local_default";
const DEFAULT_WORKSPACE_NAME = "Local Workspace";
const NEW_WORKSPACE_NAME = "New Workspace";
const DRAFT_TEMPLATE_NAV_ID = "__draft_template__";

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

export function App() {
  const initialWorkspaceRef = useRef(loadPersistedWorkspace());
  const initialWorkspace = initialWorkspaceRef.current || {};

  const [apiBase, setApiBase] = useState(initialWorkspace.apiBase || "/v1");
  const authClient = useMemo(() => createRuntimeAuthClient(apiBase), [apiBase]);
  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

  const [authMode, setAuthMode] = useState("signin");
  const [authName, setAuthName] = useState(initialWorkspace.authName || "");
  const [authEmail, setAuthEmail] = useState(initialWorkspace.authEmail || "");
  const [authPassword, setAuthPassword] = useState("");

  const [workspaceName, setWorkspaceName] = useState(
    initialWorkspace.workspaceName || DEFAULT_WORKSPACE_NAME,
  );
  const [workspaceId, setWorkspaceId] = useState(
    initialWorkspace.workspaceId || DEFAULT_WORKSPACE_ID,
  );
  const [apiKey, setApiKey] = useState(initialWorkspace.apiKey || "");
  const [apiKeysByWorkspace, setApiKeysByWorkspace] = useState(() => {
    const stored =
      initialWorkspace.apiKeysByWorkspace &&
      typeof initialWorkspace.apiKeysByWorkspace === "object"
        ? { ...initialWorkspace.apiKeysByWorkspace }
        : {};

    const initialWorkspaceId = initialWorkspace.workspaceId;
    if (initialWorkspaceId && initialWorkspace.apiKey) {
      stored[initialWorkspaceId] = initialWorkspace.apiKey;
    }

    return stored;
  });

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
  const [, setLogLines] = useState([]);
  const [latestResponse, setLatestResponse] = useState(null);

  const [activePage, setActivePage] = useState("workspace");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
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
  const [templateSearch, setTemplateSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [showDraftTemplateNav, setShowDraftTemplateNav] = useState(false);
  const [userWorkspaces, setUserWorkspaces] = useState(
    Array.isArray(initialWorkspace.userWorkspaces)
      ? initialWorkspace.userWorkspaces
      : [],
  );
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [workspaceUserActionTarget, setWorkspaceUserActionTarget] =
    useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const previewUrlsRef = useRef(new Set());
  const profilePanelRef = useRef(null);

  const hasSession = Boolean(session?.user?.id);
  const sessionUserId = String(session?.user?.id || "").trim();
  const sessionUserName = String(session?.user?.name || "").trim();
  const sessionUserEmail = String(session?.user?.email || "").trim();
  const currentProfileName = (profileName.trim() || sessionUserName).trim();
  const currentProfileEmail = (profileEmail.trim() || sessionUserEmail).trim();
  const displayProfileName = currentProfileName || "Unnamed User";
  const displayProfileEmail = currentProfileEmail || "No email";
  const profileIsDirty = profileDraftName.trim() !== currentProfileName;
  const hasApiKey = Boolean(apiKey.trim());
  const hasWorkspaceContext = Boolean(workspaceId.trim());
  const hasApiAccess = hasApiKey || (hasSession && hasWorkspaceContext);
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

  const selectedDocumentTemplateName = useMemo(() => {
    if (!selectedDocument?.template_id) {
      return "Unknown template";
    }

    const templateId = String(selectedDocument.template_id || "").trim();
    const match = templates.find(
      (template) => String(template.id || "").trim() === templateId,
    );
    const templateName = String(match?.name || "").trim();
    return templateName || templateId;
  }, [selectedDocument, templates]);

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

  const filteredDocuments = useMemo(() => {
    const query = documentSearch.trim().toLowerCase();

    return documents.filter((job) => {
      if (!query) {
        return true;
      }

      const imageName = String(job.image_name || "").toLowerCase();
      const jobId = String(job.job_id || "").toLowerCase();
      const templateId = String(job.template_id || "").toLowerCase();
      return (
        imageName.includes(query) ||
        jobId.includes(query) ||
        templateId.includes(query)
      );
    });
  }, [documentSearch, documents]);

  const contextTemplates = useMemo(() => {
    const hasDraft = showDraftTemplateNav && activePage === "templates";
    const draftItem = hasDraft
      ? [{ id: DRAFT_TEMPLATE_NAV_ID, name: "New Template", is_draft: true }]
      : [];
    return [...draftItem, ...filteredTemplates];
  }, [activePage, filteredTemplates, showDraftTemplateNav]);

  const availableWorkspaces = useMemo(() => {
    if (userWorkspaces.length > 0) {
      return userWorkspaces.map((workspace) => ({
        id: String(workspace.id || ""),
        name: String(workspace.name || "Untitled Workspace"),
        api_base: apiBase || "/v1",
        connected: true,
      }));
    }

    return [
      {
        id: workspaceId || DEFAULT_WORKSPACE_ID,
        name: workspaceName || DEFAULT_WORKSPACE_NAME,
        api_base: apiBase || "/v1",
        connected: hasApiAccess,
      },
    ];
  }, [apiBase, hasApiAccess, workspaceId, workspaceName, userWorkspaces]);

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }

    return availableWorkspaces.filter((workspace) => {
      const id = String(workspace.id || "").toLowerCase();
      const name = String(workspace.name || "").toLowerCase();
      return id.includes(query) || name.includes(query);
    });
  }, [availableWorkspaces, workspaceSearch]);

  const documentStatusMetrics = useMemo(() => {
    const metrics = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      retryable_failed: 0,
    };

    for (const job of documents) {
      if (Object.prototype.hasOwnProperty.call(metrics, job.status)) {
        metrics[job.status] += 1;
      }
    }

    return metrics;
  }, [documents]);

  const completionRate = useMemo(() => {
    if (!documents.length) {
      return 0;
    }
    return Math.round(
      (documentStatusMetrics.completed / documents.length) * 100,
    );
  }, [documentStatusMetrics.completed, documents.length]);

  const selectedWorkspaceName = useMemo(() => {
    const match = availableWorkspaces.find(
      (workspace) => String(workspace.id || "") === workspaceId,
    );
    return String(match?.name || "");
  }, [availableWorkspaces, workspaceId]);

  const activeWorkspaceName =
    selectedWorkspaceName.trim() ||
    workspaceName.trim() ||
    DEFAULT_WORKSPACE_NAME;

  const currentWorkspaceRole = useMemo(() => {
    const match = userWorkspaces.find(
      (workspace) => String(workspace.id || "") === workspaceId,
    );
    return String(match?.role || "")
      .trim()
      .toLowerCase();
  }, [userWorkspaces, workspaceId]);
  const canManageWorkspaceUsers =
    currentWorkspaceRole === "owner" || currentWorkspaceRole === "admin";
  const workspaceUserActionOptions = useMemo(() => {
    if (!workspaceUserActionTarget) {
      return [];
    }
    return getWorkspaceUserActions(
      currentWorkspaceRole,
      String(workspaceUserActionTarget.role || ""),
    );
  }, [currentWorkspaceRole, workspaceUserActionTarget]);

  const isWorkspaceNameDirty =
    Boolean(workspaceId.trim()) &&
    workspaceName.trim() !== selectedWorkspaceName.trim();

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
      authName,
      authEmail,
      workspaceName,
      workspaceId,
      apiKey,
      apiKeysByWorkspace,
      templates,
      extractTemplateId,
      lastJobId,
      jobHistory,
      selectedDocumentId,
      userWorkspaces,
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [
    apiBase,
    authName,
    authEmail,
    workspaceName,
    workspaceId,
    apiKey,
    apiKeysByWorkspace,
    templates,
    extractTemplateId,
    lastJobId,
    jobHistory,
    selectedDocumentId,
    userWorkspaces,
  ]);

  useEffect(() => {
    if (!hasSession) {
      setIsProfileMenuOpen(false);
      return;
    }

    setProfileName(sessionUserName);
    setProfileEmail(sessionUserEmail);
  }, [hasSession, sessionUserEmail, sessionUserName]);

  useEffect(() => {
    if (isProfileMenuOpen) {
      return;
    }
    setProfileDraftName(currentProfileName);
  }, [currentProfileName, isProfileMenuOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    function handlePointerDown(event) {
      if (profilePanelRef.current?.contains(event.target)) {
        return;
      }
      setIsProfileMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  function addLog(message) {
    const time = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${time}] ${message}`, ...prev].slice(0, 80));
  }

  function endpoint(path) {
    return `${baseUrl}${path}`;
  }

  async function request(
    path,
    options = {},
    authRequired = true,
    workspaceRequired = true,
  ) {
    const headers = new Headers(options.headers || {});

    if (authRequired) {
      if (hasApiKey) {
        headers.set("Authorization", `Bearer ${apiKey.trim()}`);
      } else if (hasSession) {
        if (workspaceRequired) {
          if (!workspaceId.trim()) {
            throw new Error("Workspace ID is required");
          }
          headers.set("x-workspace-id", workspaceId.trim());
        }
      } else {
        throw new Error("Sign in or provide an API key");
      }
    }

    const response = await fetch(endpoint(path), {
      ...options,
      headers,
      credentials: "include",
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
        updated_at:
          job.updated_at ||
          existing?.updated_at ||
          queuedMeta?.queued_at ||
          null,
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

  async function rotateWorkspaceApiKey(targetWorkspaceId = workspaceId) {
    const data = await request(
      `/workspaces/${encodeURIComponent(targetWorkspaceId)}/api-key`,
      {
        method: "POST",
      },
      true,
      false,
    );

    setWorkspaceId(data.workspace_id || targetWorkspaceId);
    setApiKey(data.api_key || "");
    if (data.workspace_id && data.api_key) {
      setApiKeysByWorkspace((prev) => ({
        ...prev,
        [String(data.workspace_id)]: String(data.api_key),
      }));
    }
    addLog(
      `API key rotated for workspace: ${data.workspace_id || targetWorkspaceId}`,
    );
    return data;
  }

  async function createWorkspace(options = {}) {
    const silent = Boolean(options.silent);
    const nameForCreate = NEW_WORKSPACE_NAME;

    setBusy(true);
    try {
      if (!silent) {
        addLog("Creating workspace...");
      }
      const data = await request(
        "/workspaces",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nameForCreate,
          }),
        },
        true,
        false,
      );
      setWorkspaceId(data.workspace_id || "");
      setWorkspaceName(data.name || NEW_WORKSPACE_NAME);
      setApiKey(data.api_key || "");
      if (data.workspace_id && data.api_key) {
        setApiKeysByWorkspace((prev) => ({
          ...prev,
          [String(data.workspace_id)]: String(data.api_key),
        }));
      }
      if (!silent) {
        addLog(`Workspace created: ${data.workspace_id || "unknown"}`);
      }
      await listWorkspaces();
    } catch (error) {
      addLog(`Create workspace failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshApiKey() {
    if (!workspaceId.trim()) {
      addLog("Refresh API key failed: select or create a workspace first");
      return;
    }

    const targetWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID;

    setBusy(true);
    try {
      await rotateWorkspaceApiKey(targetWorkspaceId);
    } catch (error) {
      addLog(`Refresh API key failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function listWorkspaces() {
    if (!hasSession) {
      return;
    }

    try {
      const data = await request("/workspaces", { method: "GET" }, true, false);
      const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
      setUserWorkspaces(workspaces);
      if (!workspaceId && workspaces[0]?.id) {
        const nextWorkspaceId = String(workspaces[0].id);
        setWorkspaceId(nextWorkspaceId);
        setWorkspaceName(String(workspaces[0].name || DEFAULT_WORKSPACE_NAME));
        setApiKey(String(apiKeysByWorkspace[nextWorkspaceId] || ""));
      }
      return workspaces;
    } catch (error) {
      addLog(`List workspaces failed: ${error.message}`);
      return [];
    }
  }

  async function listWorkspaceUsers(targetWorkspaceId = workspaceId) {
    const normalizedWorkspaceId = String(targetWorkspaceId || "").trim();
    if (!hasSession || !normalizedWorkspaceId) {
      setWorkspaceUsers([]);
      return;
    }

    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/users`,
        { method: "GET" },
        true,
        false,
      );
      setWorkspaceUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (error) {
      setWorkspaceUsers([]);
      addLog(`List workspace users failed: ${error.message}`);
    }
  }

  async function applyWorkspaceUserAction(targetUserId, action) {
    const targetWorkspaceId = String(workspaceId || "").trim();
    const targetId = String(targetUserId || "").trim();
    if (!targetWorkspaceId || !targetId) {
      return;
    }

    setBusy(true);
    try {
      await request(
        `/workspaces/${encodeURIComponent(targetWorkspaceId)}/users/${encodeURIComponent(targetId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
        true,
        false,
      );
      await listWorkspaces();
      await listWorkspaceUsers(targetWorkspaceId);
      addLog(`User updated (${action.replace(/_/g, " ")})`);
    } catch (error) {
      addLog(`User update failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function inviteUser() {
    if (!workspaceId.trim()) {
      addLog("Invite failed: select a workspace first");
      return;
    }
    if (!inviteEmail.trim()) {
      addLog("Invite failed: email is required");
      return;
    }

    setBusy(true);
    try {
      await request(
        `/workspaces/${encodeURIComponent(workspaceId.trim())}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        },
      );
      addLog(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch (error) {
      addLog(`Invite failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkspaceChanges() {
    if (!workspaceId.trim()) {
      addLog("Save changes failed: select a workspace first");
      return;
    }
    if (!isWorkspaceNameDirty) {
      return;
    }

    setBusy(true);
    try {
      await request(`/workspaces/${encodeURIComponent(workspaceId.trim())}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      await listWorkspaces();
      addLog(`Workspace renamed to ${workspaceName.trim()}`);
    } catch (error) {
      addLog(`Save changes failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkspace() {
    if (!workspaceId.trim()) {
      addLog("Delete workspace failed: select a workspace first");
      return;
    }

    const confirmed = window.confirm(
      `Delete workspace ${workspaceId.trim()}? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await request(`/workspaces/${encodeURIComponent(workspaceId.trim())}`, {
        method: "DELETE",
      });
      setWorkspaceId("");
      setWorkspaceName("");
      setApiKey("");
      setApiKeysByWorkspace((prev) => {
        const next = { ...prev };
        delete next[workspaceId.trim()];
        return next;
      });
      const workspaces = await listWorkspaces();
      if (Array.isArray(workspaces) && workspaces.length > 0) {
        const nextWorkspaceId = String(workspaces[0].id || "");
        setWorkspaceId(nextWorkspaceId);
        setWorkspaceName(String(workspaces[0].name || DEFAULT_WORKSPACE_NAME));
        setApiKey(String(apiKeysByWorkspace[nextWorkspaceId] || ""));
      }
      addLog("Workspace deleted");
    } catch (error) {
      addLog(`Delete workspace failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword.trim()) {
      addLog("Sign in failed: email and password are required");
      return;
    }

    setBusy(true);
    try {
      const result = await authClient.signIn.email({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (result.error) {
        throw new Error(result.error.message || "Sign in failed");
      }
      setAuthPassword("");
      await refetchSession();
      addLog(`Signed in as ${authEmail.trim()}`);
    } catch (error) {
      addLog(`Sign in failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    if (!authName.trim() || !authEmail.trim() || !authPassword.trim()) {
      addLog("Sign up failed: name, email, and password are required");
      return;
    }

    setBusy(true);
    try {
      const result = await authClient.signUp.email({
        name: authName.trim(),
        email: authEmail.trim(),
        password: authPassword,
      });
      if (result.error) {
        throw new Error(result.error.message || "Sign up failed");
      }
      setAuthPassword("");
      await refetchSession();
      addLog(`Account created for ${authEmail.trim()}`);
    } catch (error) {
      addLog(`Sign up failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (result?.error) {
        throw new Error(result.error.message || "Google sign in failed");
      }
    } catch (error) {
      addLog(`Google sign in failed: ${error.message}`);
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
      setApiKey("");
      setApiKeysByWorkspace({});
      setWorkspaceId("");
      setTemplates([]);
      setJobHistory([]);
      setWorkspaceUsers([]);
      await refetchSession();
      addLog("Signed out");
    } catch (error) {
      addLog(`Sign out failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile() {
    if (!hasSession) {
      return;
    }

    try {
      const data = await request("/profile", { method: "GET" }, true, false);
      const nextName = String(data?.name || "").trim();
      const nextEmail = String(data?.email || "").trim();
      setProfileName(nextName);
      setProfileEmail(nextEmail);
      setAuthName(nextName);
      setAuthEmail(nextEmail);
    } catch (error) {
      addLog(`Load profile failed: ${error.message}`);
    }
  }

  async function saveProfile() {
    const name = profileDraftName.trim();
    const email = currentProfileEmail.toLowerCase();

    if (!name) {
      addLog("Profile update failed: name is required");
      return;
    }

    setIsSavingProfile(true);
    try {
      const data = await request(
        "/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        },
        true,
        false,
      );
      const nextName = String(data?.name || name);
      const nextEmail = String(data?.email || email);
      setProfileName(nextName);
      setProfileEmail(nextEmail);
      setAuthName(nextName);
      setAuthEmail(nextEmail);
      await refetchSession();
      addLog("Profile updated");
      setIsProfileMenuOpen(false);
    } catch (error) {
      addLog(`Profile update failed: ${error.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  }

  useEffect(() => {
    if (!hasApiAccess) {
      setJobHistory([]);
      setQueuedJobs({});
      return;
    }

    void listTemplates();
    void listJobs();
  }, [hasApiAccess, workspaceId, apiKey]);

  useEffect(() => {
    if (!hasSession) {
      return;
    }

    void listWorkspaces();
    void loadProfile();
  }, [hasSession]);

  useEffect(() => {
    if (!hasSession || !workspaceId.trim()) {
      setWorkspaceUsers([]);
      return;
    }

    void listWorkspaceUsers(workspaceId.trim());
  }, [hasSession, workspaceId]);

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

  async function listJobs() {
    try {
      const data = await request("/jobs", { method: "GET" });
      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      setJobHistory(list);
      if (!selectedDocumentId && list[0]?.job_id) {
        setSelectedDocumentId(String(list[0].job_id));
      }
      addLog(`Loaded ${list.length} documents`);
    } catch (error) {
      addLog(`List documents failed: ${error.message}`);
    }
  }

  async function loadJobDetails(jobId, { silent = true } = {}) {
    const normalizedJobId = String(jobId || "").trim();
    if (!normalizedJobId) {
      return;
    }

    try {
      const data = await request(
        `/jobs/${encodeURIComponent(normalizedJobId)}`,
        {
          method: "GET",
        },
      );
      upsertJobHistory(data);
    } catch (error) {
      if (!silent) {
        addLog(`Load job details failed: ${error.message}`);
      }
    }
  }

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim()) {
      return;
    }

    void loadJobDetails(selectedDocumentId, { silent: true });
  }, [hasApiAccess, selectedDocumentId]);

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
      setShowDraftTemplateNav(false);
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

  async function loadTemplateForEditing(templateIdOverride = "") {
    const targetTemplateId = String(
      templateIdOverride || updateTemplateId,
    ).trim();
    if (!targetTemplateId) {
      addLog("Load template failed: template ID is required");
      return;
    }

    setBusy(true);
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
      setExtractTemplateId(targetTemplateId);
      addLog(`Loaded template ${targetTemplateId} for editing`);
    } catch (error) {
      addLog(`Load template failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function startNewTemplateDraft() {
    setShowDraftTemplateNav(true);
    setUpdateTemplateId("");
    setTemplateName("Prescription Template");
    setTemplateDescription(
      "Extract medication and prescription fields from a document image",
    );
    setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
    addLog("Switched to new template draft");
  }

  function handleSidebarNavigation(pageId) {
    setActivePage(pageId);
    if (pageId !== "templates") {
      return;
    }

    const latestTemplateId = String(templates[0]?.id || "").trim();
    if (latestTemplateId) {
      void loadTemplateForEditing(latestTemplateId);
    }
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

  function removeDocumentFromState(targetDocumentId, imagePreviewUrl) {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      previewUrlsRef.current.delete(imagePreviewUrl);
    }

    setJobHistory((prev) =>
      prev.filter((job) => String(job.job_id || "") !== targetDocumentId),
    );
    setQueuedJobs((prev) => {
      const next = { ...prev };
      delete next[targetDocumentId];
      return next;
    });

    if (lastJobId === targetDocumentId) {
      setLastJobId("");
    }
    if (selectedDocumentId === targetDocumentId) {
      setSelectedDocumentId("");
    }
    if (latestResponse?.job_id === targetDocumentId) {
      setLatestResponse(null);
    }
  }

  async function deleteSelectedDocument() {
    if (!selectedDocument?.job_id) {
      addLog("Delete document failed: select a document first");
      return;
    }
    if (isDeletingDocument) {
      return;
    }

    const targetDocumentId = String(selectedDocument.job_id);
    if (
      !window.confirm(
        `Delete document ${targetDocumentId}? This will permanently remove it from the workspace.`,
      )
    ) {
      return;
    }

    setIsDeletingDocument(true);
    try {
      await request(`/jobs/${encodeURIComponent(targetDocumentId)}`, {
        method: "DELETE",
      });
      removeDocumentFromState(
        targetDocumentId,
        selectedDocument.image_preview_url,
      );
      addLog(`Deleted document ${targetDocumentId}`);
    } catch (error) {
      if (Number(error?.status) === 404) {
        removeDocumentFromState(
          targetDocumentId,
          selectedDocument.image_preview_url,
        );
        addLog(`Document ${targetDocumentId} was already removed`);
        return;
      }
      addLog(`Delete document failed: ${error.message}`);
    } finally {
      setIsDeletingDocument(false);
    }
  }

  if (isSessionPending) {
    return null;
  }

  if (!hasSession) {
    return (
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">Data Extraction</p>
            <h1>Studio</h1>
            <p>
              {authMode === "signin"
                ? "Welcome back. Sign in to continue working in your workspace."
                : "Create your account to start extracting structured data from documents."}
            </p>
          </div>

          <div className="status-strip auth-status-strip">
            <span className="status-chip good">Secure auth</span>
            <span className="status-chip">Workspace-ready</span>
          </div>

          <section className="panel auth-panel">
            <h2>{authMode === "signin" ? "Sign in" : "Create account"}</h2>
            <p className="muted">
              Sign in first, then create or select a workspace.
            </p>
            <div
              className={
                authMode === "signup"
                  ? "row two-up auth-form-grid"
                  : "row auth-form-grid"
              }
            >
              {authMode === "signup" ? (
                <label>
                  Name
                  <input
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="Jane Doe"
                  />
                </label>
              ) : null}
              <label>
                Email
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="jane@example.com"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </label>
            </div>
            {authMode === "signin" ? (
              <>
                <button
                  type="button"
                  className="auth-primary-action"
                  disabled={busy}
                  onClick={signIn}
                >
                  Sign In
                </button>
                <div className="auth-divider" aria-hidden="true">
                  <span>or continue with</span>
                </div>
                <button
                  type="button"
                  className="secondary auth-provider-action"
                  disabled={busy}
                  onClick={signInWithGoogle}
                >
                  Sign in with Google
                </button>
                <p className="auth-switch-copy">
                  Don&apos;t have an account?{" "}
                  <a
                    href="#"
                    className="auth-switch-link"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!busy) {
                        setAuthMode("signup");
                      }
                    }}
                  >
                    Sign Up
                  </a>
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="auth-primary-action"
                  disabled={busy}
                  onClick={signUp}
                >
                  Create Account
                </button>
                <p className="auth-switch-copy">
                  Already have an account?{" "}
                  <a
                    href="#"
                    className="auth-switch-link"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!busy) {
                        setAuthMode("signin");
                      }
                    }}
                  >
                    Sign In
                  </a>
                </p>
              </>
            )}
          </section>
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
              onClick={() => handleSidebarNavigation(item.id)}
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              <span className="sidebar-link-count">
                {item.id === "templates"
                  ? templates.length
                  : item.id === "documents"
                    ? documents.length
                    : item.id === "workspace"
                      ? availableWorkspaces.length
                      : ""}
              </span>
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar-upload-button"
          disabled={busy || !hasApiAccess}
          onClick={openUploadModal}
        >
          Upload Document
        </button>

        <div className="sidebar-spacer" aria-hidden="true" />

        <div className="sidebar-footer">
          <div className="sidebar-profile" ref={profilePanelRef}>
            <button
              type="button"
              className="sidebar-profile-trigger"
              onClick={() =>
                setIsProfileMenuOpen((currentOpen) => !currentOpen)
              }
            >
              <span className="sidebar-profile-avatar" aria-hidden="true">
                {profileInitials(displayProfileName, displayProfileEmail)}
              </span>
              <span className="sidebar-profile-meta">
                <strong>{displayProfileName}</strong>
                <span>{displayProfileEmail}</span>
              </span>
            </button>

            {isProfileMenuOpen ? (
              <div className="sidebar-profile-popout">
                <label>
                  Name
                  <input
                    value={profileDraftName}
                    onChange={(event) =>
                      setProfileDraftName(event.target.value)
                    }
                    placeholder="Jane Doe"
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={isSavingProfile || !profileIsDirty}
                    onClick={saveProfile}
                  >
                    {isSavingProfile ? "Saving..." : "Save Profile"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || isSavingProfile}
                    onClick={signOut}
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <aside className="context-sidebar">
        <div className="context-head">
          <p className="eyebrow">Control Center</p>
          <h2>
            {activePage === "documents"
              ? "Jobs"
              : activePage === "templates"
                ? "Templates"
                : "Workspaces"}
          </h2>
        </div>

        {activePage === "documents" ? (
          <>
            <label>
              Search Jobs
              <input
                value={documentSearch}
                onChange={(event) => setDocumentSearch(event.target.value)}
                placeholder="Job ID or file"
              />
            </label>
            <div className="context-list">
              {filteredDocuments.slice(0, 12).map((job) => (
                <button
                  type="button"
                  key={`context-${job.job_id}`}
                  className={
                    selectedDocument?.job_id === job.job_id
                      ? "context-item active"
                      : "context-item"
                  }
                  onClick={() => setSelectedDocumentId(job.job_id)}
                >
                  <strong>
                    {job.image_name ||
                      defaultUploadedName(job.source_mime_type)}
                  </strong>
                  <span>{job.job_id}</span>
                </button>
              ))}
            </div>
          </>
        ) : activePage === "templates" ? (
          <>
            <label>
              Search Templates
              <input
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Template name or ID"
              />
            </label>
            <div className="context-list">
              {contextTemplates.slice(0, 12).map((template) => (
                <button
                  type="button"
                  key={`context-${template.id}`}
                  className={
                    template.is_draft
                      ? !isEditingTemplate
                        ? "context-item active"
                        : "context-item"
                      : updateTemplateId === template.id
                        ? "context-item active"
                        : "context-item"
                  }
                  onClick={() => {
                    if (template.is_draft) {
                      startNewTemplateDraft();
                    } else {
                      setActivePage("templates");
                      loadTemplateForEditing(template.id);
                    }
                  }}
                >
                  <strong>
                    {template.is_draft
                      ? "New Template Draft"
                      : template.name || "Untitled template"}
                  </strong>
                  <span>{template.is_draft ? "Unsaved" : template.id}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label>
              Search Workspaces
              <input
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                placeholder="Workspace name or ID"
              />
            </label>
            <div className="context-list">
              {filteredWorkspaces.map((workspace) => (
                <button
                  type="button"
                  key={`workspace-${workspace.id}`}
                  className={
                    workspace.id === (workspaceId || DEFAULT_WORKSPACE_ID)
                      ? "context-item context-item-workspace active"
                      : "context-item context-item-workspace"
                  }
                  onClick={() => {
                    setWorkspaceId(workspace.id);
                    setWorkspaceName(workspace.name);
                    setApiKey(
                      String(apiKeysByWorkspace[String(workspace.id)] || ""),
                    );
                    addLog(`Switched workspace context to ${workspace.id}`);
                  }}
                >
                  <strong>{workspace.name}</strong>
                  <span>{workspace.id}</span>
                  <span>
                    {workspace.connected ? "Connected" : "No API key"}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="context-foot">
          {activePage === "documents" ? (
            <>
              <span className="status-chip">
                Queued {documentStatusMetrics.queued}
              </span>
              <span className="status-chip good">
                Completed {documentStatusMetrics.completed}
              </span>
            </>
          ) : activePage === "templates" ? (
            <>
              <span className="status-chip">Templates {templates.length}</span>
              <span className="status-chip good">
                {isEditingTemplate ? "Editing" : "Draft"}
              </span>
            </>
          ) : (
            <>
              <span className="status-chip">
                Workspaces {availableWorkspaces.length}
              </span>
              <span className={`status-chip ${hasApiAccess ? "good" : "warn"}`}>
                API {hasApiAccess ? "Ready" : "Missing"}
              </span>
            </>
          )}
        </div>
      </aside>

      <main className="main-content">
        <section className="workspace-toolbar" aria-label="Workspace toolbar">
          <div className="workspace-toolbar-meta">
            <span className="status-chip">Workspace {activeWorkspaceName}</span>
            <span className={`status-chip ${hasApiAccess ? "good" : "warn"}`}>
              API {hasApiAccess ? "Ready" : "Missing Access"}
            </span>
            <span className="status-chip">Jobs {documents.length}</span>
          </div>
          <div className="actions compact">
            <button
              type="button"
              className="secondary"
              disabled={busy || (activePage === "documents" && !hasApiAccess)}
              onClick={
                activePage === "templates"
                  ? startNewTemplateDraft
                  : activePage === "workspace"
                    ? createWorkspace
                    : openUploadModal
              }
            >
              {activePage === "templates"
                ? "Create Template"
                : activePage === "workspace"
                  ? "Create Workspace"
                  : "Upload Document"}
            </button>
            {activePage === "workspace" ? (
              <button
                type="button"
                className="danger"
                disabled={busy || !workspaceId.trim()}
                onClick={deleteWorkspace}
              >
                Delete Workspace
              </button>
            ) : activePage === "templates" ? (
              <button
                type="button"
                className="danger"
                disabled={busy || !hasApiAccess || !updateTemplateId.trim()}
                onClick={deleteTemplate}
              >
                Delete Template
              </button>
            ) : activePage === "documents" ? (
              <button
                type="button"
                className="danger"
                disabled={
                  busy || isDeletingDocument || !selectedDocument?.job_id
                }
                onClick={deleteSelectedDocument}
              >
                {isDeletingDocument ? "Deleting..." : "Delete Document"}
              </button>
            ) : null}
          </div>
        </section>

        <section className="kpi-grid" aria-label="Operational metrics">
          <article className="kpi-card">
            <p className="kpi-label">Templates</p>
            <p className="kpi-value">{templates.length}</p>
            <p className="kpi-meta">Active extraction schemas</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Documents</p>
            <p className="kpi-value">{documents.length}</p>
            <p className="kpi-meta">Queued and completed jobs</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Completion</p>
            <p className="kpi-value">{completionRate}%</p>
            <p className="kpi-meta">Successful jobs ratio</p>
            <div
              className="kpi-progress"
              role="img"
              aria-label={`Completion rate ${completionRate}%`}
            >
              <span style={{ width: `${completionRate}%` }} />
            </div>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Failures</p>
            <p className="kpi-value">
              {documentStatusMetrics.failed +
                documentStatusMetrics.retryable_failed}
            </p>
            <p className="kpi-meta">Includes retryable failures</p>
          </article>
        </section>

        {activePage === "workspace" ? (
          <>
            <header className="page-header">
              <p className="eyebrow">Workspace</p>
              <h2>Environment and Access</h2>
              <p>
                Manage API connection details, workspace credentials, and
                workspace state from one place.
              </p>
            </header>

            <section className="content-grid workspace-page-grid">
              <article className="workspace-card">
                <div className="workspace-head">
                  <h2>Connection Settings</h2>
                  <p>Manage workspace details and rotate API credentials.</p>
                </div>
                <div className="row two-up workspace-name-row">
                  <label>
                    Workspace name
                    <input
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary workspace-inline-action"
                    disabled={busy || !isWorkspaceNameDirty}
                    onClick={saveWorkspaceChanges}
                  >
                    Save Changes
                  </button>
                </div>
                <label>
                  API key
                  <div className="row two-up workspace-key-row">
                    <input
                      value={apiKey}
                      readOnly
                      placeholder="Rotate to generate key_ + 32 chars"
                    />
                    <button
                      type="button"
                      className="workspace-inline-action"
                      disabled={busy}
                      onClick={refreshApiKey}
                    >
                      Refresh API Key
                    </button>
                  </div>
                </label>
              </article>

              <article className="workspace-card">
                <div className="workspace-head">
                  <h2>Invite Users</h2>
                  <p>Invite teammates to join this workspace.</p>
                </div>
                <div className="row two-up">
                  <label>
                    Invite email
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="teammate@example.com"
                    />
                  </label>
                  <label>
                    Invite role
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !workspaceId.trim()}
                    onClick={inviteUser}
                  >
                    Invite User
                  </button>
                </div>
              </article>
            </section>

            <section className="content-grid workspace-users-grid">
              <article className="workspace-card">
                <div className="workspace-head">
                  <h2>Workspace Users</h2>
                  <p>Current members and their roles.</p>
                </div>
                {workspaceUsers.length ? (
                  <div className="table-scroll workspace-users-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Joined</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceUsers.map((user) => (
                          <tr key={String(user.user_id || user.email || "")}>
                            <td>{String(user.name || "-")}</td>
                            <td>{String(user.email || "-")}</td>
                            <td>
                              <span className="role-badge">
                                {formatRoleLabel(user.role)}
                              </span>
                            </td>
                            <td>{formatJoinedAt(user.created_at)}</td>
                            <td>
                              {canManageWorkspaceUsers &&
                              String(user.user_id || "").trim() !==
                                sessionUserId ? (
                                <button
                                  type="button"
                                  className="icon-action-button"
                                  aria-label="Edit user"
                                  onClick={() =>
                                    setWorkspaceUserActionTarget(user)
                                  }
                                >
                                  ✎
                                </button>
                              ) : (
                                <span className="muted">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No workspace users found.</p>
                )}
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
                Build reusable extraction schemas and update existing templates.
              </p>
            </header>

            <section className="content-grid templates-grid">
              <article className="workspace-card create-template-panel">
                <div className="workspace-head">
                  <h2>
                    {isEditingTemplate ? "Edit Template" : "Create Template"}
                  </h2>
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
                    disabled={busy || !hasApiAccess}
                    onClick={
                      isEditingTemplate ? updateTemplate : createTemplate
                    }
                  >
                    {isEditingTemplate ? "Save Changes" : "Save New Template"}
                  </button>
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
              <article className="workspace-card job-status-panel">
                <div className="workspace-head">
                  <h2>Job Status</h2>
                  <p>Track the selected extraction stage in real time.</p>
                </div>
                <JobStatusTracker job={selectedDocument} />
              </article>

              <article className="workspace-card result-view">
                <div className="workspace-head result-view-head">
                  <div>
                    <h2>Document Details</h2>
                    <p>Review extraction output for the selected upload.</p>
                  </div>
                  {selectedDocument ? (
                    <span className="status-chip good template-name-badge">
                      {selectedDocumentTemplateName}
                    </span>
                  ) : null}
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

      {workspaceUserActionTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => setWorkspaceUserActionTarget(null)}
        >
          <div
            className="modal-card workspace-user-action-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Manage workspace user"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="workspace-head">
              <h2>Manage User</h2>
              <p>
                {String(workspaceUserActionTarget.name || "Unknown User")} -{" "}
                {formatRoleLabel(workspaceUserActionTarget.role)}
              </p>
            </div>
            {workspaceUserActionOptions.length ? (
              <div className="workspace-user-action-list">
                {workspaceUserActionOptions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={action === "remove_user" ? "danger" : "ghost"}
                    disabled={busy}
                    onClick={() => {
                      void applyWorkspaceUserAction(
                        workspaceUserActionTarget.user_id,
                        action,
                      );
                      setWorkspaceUserActionTarget(null);
                    }}
                  >
                    {workspaceUserActionLabel(action)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No actions available for this user.</p>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setWorkspaceUserActionTarget(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                disabled={busy || !hasApiAccess}
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

function formatJoinedAt(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return raw;
  }

  return new Date(timestamp).toLocaleDateString();
}

function formatRoleLabel(value) {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (!role) {
    return "-";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getWorkspaceUserActions(currentRole, targetRole) {
  const actor = String(currentRole || "")
    .trim()
    .toLowerCase();
  const target = String(targetRole || "")
    .trim()
    .toLowerCase();

  if (actor === "admin") {
    return target === "member" ? ["remove_user"] : [];
  }
  if (actor === "owner") {
    return ["remove_user", "make_admin", "make_owner"];
  }
  return [];
}

function workspaceUserActionLabel(action) {
  if (action === "remove_user") {
    return "Remove User";
  }
  if (action === "make_admin") {
    return "Make Admin";
  }
  if (action === "make_owner") {
    return "Make Owner";
  }
  return "Action";
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

function JobStatusTracker({ job }) {
  if (!job) {
    return <p className="muted">Select an uploaded document.</p>;
  }

  const isFailure =
    job.status === "failed" || job.status === "retryable_failed";
  const isCompleted = job.status === "completed";
  const isProcessing = job.status === "processing";
  const statusLabel = isFailure
    ? "This extraction finished with a failure status."
    : isCompleted
      ? "This extraction completed successfully."
      : isProcessing
        ? "The job is processing"
        : "The job is queued";
  const isTerminal = isCompleted || isFailure;

  return (
    <div className="job-status-stack">
      <div
        className={`job-status-skeleton ${
          isTerminal ? "is-terminal" : "is-processing"
        } ${isFailure ? "is-failed" : ""}`}
      >
        <span className="job-status-spinner" aria-hidden="true" />
        <p>{statusLabel}</p>
      </div>
    </div>
  );
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
      columns: schema.columns.map((column, i) => {
        if (i !== columnIndex) {
          return column;
        }

        if (key === "heading") {
          const sanitizedHeading = normalizeFieldName(value);
          return {
            ...column,
            heading: sanitizedHeading,
            key: toFieldId(sanitizedHeading),
          };
        }

        if (key === "key") {
          return column;
        }

        return { ...column, [key]: value };
      }),
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
                                readOnly
                                placeholder="auto_generated_from_heading"
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
  const workspaceId = response.workspace_id;
  const hasWorkspace = Boolean(workspaceId);

  return (
    <div className="response-card">
      <div className="response-badges">
        {hasJob ? <span className="status-chip good">Job response</span> : null}
        {hasWorkspace ? (
          <span className="status-chip good">Workspace response</span>
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
      {workspaceId ? (
        <p>
          <strong>Workspace:</strong> {workspaceId}
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
    heading: normalizeFieldName(String(column?.heading || "")),
    key:
      toFieldId(String(column?.heading || "")) ||
      String(column?.key || "").trim(),
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

function profileInitials(name, email) {
  const source = String(name || "").trim() || String(email || "").trim();
  if (!source) {
    return "U";
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
