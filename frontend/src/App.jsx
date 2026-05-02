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
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [isRetryingDocument, setIsRetryingDocument] = useState(false);
  const [loadingDocumentDetailsId, setLoadingDocumentDetailsId] = useState("");
  const [uploadTemplateId, setUploadTemplateId] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [queuedJobs, setQueuedJobs] = useState({});
  const [jobHistory, setJobHistory] = useState(
    Array.isArray(initialWorkspace.jobHistory)
      ? initialWorkspace.jobHistory
      : [],
  );
  const [jobsNextCursor, setJobsNextCursor] = useState(null);
  const [jobsHasMore, setJobsHasMore] = useState(false);
  const [isLoadingMoreJobs, setIsLoadingMoreJobs] = useState(false);
  const [manualJobLookupId, setManualJobLookupId] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    initialWorkspace.selectedDocumentId || "",
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [debouncedDocumentSearch, setDebouncedDocumentSearch] = useState("");
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
  const uploadInputRef = useRef(null);

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
    const query = debouncedDocumentSearch.trim().toLowerCase();
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
      }))
      .filter((job) => {
        if (!query) {
          return true;
        }

        return [job.job_id, job.image_name, job.template_id, job.status]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(query));
      });

    return [...jobHistory, ...queuedOnly].sort((a, b) => {
      const left = getDocumentSortTimestamp(b);
      const right = getDocumentSortTimestamp(a);
      return left - right;
    });
  }, [debouncedDocumentSearch, extractTemplateId, jobHistory, queuedJobs]);

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

  const contextTemplates = useMemo(() => {
    const hasDraft = showDraftTemplateNav && activePage === "templates";
    const draftItem = hasDraft
      ? [{ id: DRAFT_TEMPLATE_NAV_ID, name: "New Template", is_draft: true }]
      : [];
    return [...draftItem, ...filteredTemplates];
  }, [activePage, filteredTemplates, showDraftTemplateNav]);

  const availableWorkspaces = useMemo(() => {
    if (userWorkspaces.length > 0) {
      const activeWorkspaceId = String(workspaceId || "");
      return userWorkspaces.map((workspace) => ({
        id: String(workspace.id || ""),
        name: String(workspace.name || "Untitled Workspace"),
        api_base: apiBase || "/v1",
        connected: String(workspace.id || "") === activeWorkspaceId,
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
        current_attempt:
          typeof job.current_attempt === "number"
            ? job.current_attempt
            : typeof existing?.current_attempt === "number"
              ? existing.current_attempt
              : 0,
        completed_attempt:
          typeof job.completed_attempt === "number"
            ? job.completed_attempt
            : typeof existing?.completed_attempt === "number"
              ? existing.completed_attempt
              : 0,
        last_failed_attempt:
          typeof job.last_failed_attempt === "number"
            ? job.last_failed_attempt
            : typeof existing?.last_failed_attempt === "number"
              ? existing.last_failed_attempt
              : 0,
      };
      const next = [
        normalized,
        ...prev.filter((entry) => entry.job_id !== job.job_id),
      ];
      next.sort((a, b) => {
        const left = getDocumentSortTimestamp(b);
        const right = getDocumentSortTimestamp(a);
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
      const normalizedWorkspaceId = String(workspaceId || "").trim();
      const hasSelectedWorkspace = workspaces.some(
        (workspace) => String(workspace?.id || "") === normalizedWorkspaceId,
      );

      if ((!normalizedWorkspaceId || !hasSelectedWorkspace) && workspaces[0]?.id) {
        const nextWorkspaceId = String(workspaces[0].id || "");
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
    if (isSavingWorkspace) {
      return;
    }
    if (!isWorkspaceNameDirty) {
      return;
    }

    setIsSavingWorkspace(true);
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
      setIsSavingWorkspace(false);
    }
  }

  async function deleteWorkspace() {
    if (!workspaceId.trim()) {
      addLog("Delete workspace failed: select a workspace first");
      return;
    }
    if (isDeletingWorkspace) {
      return;
    }

    const confirmed = window.confirm(
      `Delete workspace ${workspaceId.trim()}? This action cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingWorkspace(true);
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
      setIsDeletingWorkspace(false);
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
    const timer = window.setTimeout(() => {
      setDebouncedDocumentSearch(documentSearch.trim());
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [documentSearch]);

  useEffect(() => {
    if (!hasApiAccess) {
      setTemplates([]);
      setJobHistory([]);
      setQueuedJobs({});
      setJobsNextCursor(null);
      setJobsHasMore(false);
      return;
    }

    void listTemplates();
  }, [hasApiAccess, workspaceId, apiKey]);

  useEffect(() => {
    if (!hasApiAccess) {
      return;
    }

    void listJobs();
  }, [debouncedDocumentSearch, hasApiAccess, workspaceId, apiKey]);

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
    try {
      const data = await request("/templates", { method: "GET" });
      const list = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(list);
      if (!extractTemplateId && list.length > 0) {
        setExtractTemplateId(list[0].id);
      }
      addLog(`Loaded ${list.length} templates`);
      return list;
    } catch (error) {
      addLog(`List templates failed: ${error.message}`);
      return [];
    }
  }

  async function listJobs({ append = false } = {}) {
    try {
      const params = new URLSearchParams();
      const search = debouncedDocumentSearch.trim();
      if (search) {
        params.set("search", search);
      }
      if (append && jobsNextCursor) {
        params.set("cursor", jobsNextCursor);
      }

      const query = params.toString();
      const data = await request(query ? `/jobs?${query}` : "/jobs", { method: "GET" });
      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      setJobHistory((prev) => {
        if (!append) {
          return list;
        }

        const seen = new Set(prev.map((job) => String(job.job_id || "")));
        const additions = list.filter((job) => {
          const jobId = String(job.job_id || "");
          if (!jobId || seen.has(jobId)) {
            return false;
          }
          seen.add(jobId);
          return true;
        });
        return [...prev, ...additions];
      });
      setJobsNextCursor(data?.next_cursor || null);
      setJobsHasMore(Boolean(data?.has_more));
      if (!selectedDocumentId && list[0]?.job_id) {
        setSelectedDocumentId(String(list[0].job_id));
      }
      addLog(`${append ? "Loaded" : "Loaded"} ${list.length} document${list.length === 1 ? "" : "s"}${search ? ` matching "${search}"` : ""}`);
    } catch (error) {
      addLog(`List documents failed: ${error.message}`);
    }
  }

  async function loadMoreJobs() {
    if (!jobsHasMore || !jobsNextCursor || isLoadingMoreJobs) {
      return;
    }

    setIsLoadingMoreJobs(true);
    try {
      await listJobs({ append: true });
    } finally {
      setIsLoadingMoreJobs(false);
    }
  }

  async function loadJobDetails(jobId, { silent = true, showLoading = false } = {}) {
    const normalizedJobId = String(jobId || "").trim();
    if (!normalizedJobId) {
      return;
    }

    if (showLoading) {
      setLoadingDocumentDetailsId(normalizedJobId);
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
    } finally {
      if (showLoading) {
        setLoadingDocumentDetailsId((currentId) =>
          currentId === normalizedJobId ? "" : currentId,
        );
      }
    }
  }

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim()) {
      return;
    }

    void loadJobDetails(selectedDocumentId, { silent: true, showLoading: true });
  }, [hasApiAccess, selectedDocumentId]);

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim()) {
      return;
    }

    const liveStatus = String(selectedDocument?.status || "").toLowerCase();
    if (liveStatus !== "queued" && liveStatus !== "processing") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadJobDetails(selectedDocumentId, { silent: true });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasApiAccess, selectedDocumentId, selectedDocument?.status]);

  async function createTemplate() {
    if (isSavingTemplate) {
      return;
    }

    setIsSavingTemplate(true);
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

    const fields = normalizeFields(templateFields);

    setIsSavingTemplate(true);
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

    setIsDeletingTemplate(true);
    try {
      await request(`/templates/${encodeURIComponent(deletedTemplateId)}`, {
        method: "DELETE",
      });
      addLog(`Template deleted: ${deletedTemplateId}`);
      const remainingTemplates = await listTemplates();
      const nextTemplate = remainingTemplates.find(
        (template) => String(template.id || "").trim() !== deletedTemplateId,
      );

      setShowDraftTemplateNav(false);
      if (nextTemplate?.id) {
        await loadTemplateForEditing(nextTemplate.id);
      } else {
        setUpdateTemplateId("");
        setExtractTemplateId("");
        setTemplateName("Prescription Template");
        setTemplateDescription(
          "Extract medication and prescription fields from a document image",
        );
        setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
      }
    } catch (error) {
      addLog(`Delete template failed: ${error.message}`);
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
      setExtractTemplateId(targetTemplateId);
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
    setUploadFiles([]);
    setIsUploadDragActive(false);
    setShowUploadModal(true);
  }

  function closeUploadModal() {
    if (isUploadingDocuments) {
      return;
    }
    setIsUploadDragActive(false);
    setShowUploadModal(false);
  }

  function handleUploadDragOver(event) {
    event.preventDefault();
    setIsUploadDragActive(true);
  }

  function handleUploadDragLeave(event) {
    event.preventDefault();
    setIsUploadDragActive(false);
  }

  function handleUploadDrop(event) {
    event.preventDefault();
    setIsUploadDragActive(false);
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    appendUploadFiles(droppedFiles);
  }

  function appendUploadFiles(nextFiles) {
    const filtered = nextFiles.filter(Boolean);
    if (!filtered.length) {
      return;
    }

    setUploadFiles((prev) => {
      const existingKeys = new Set(
        prev.map((entry) =>
          fileDedupKey(
            entry.file.name,
            entry.file.size,
            entry.file.lastModified,
          ),
        ),
      );
      const additions = [];

      for (const file of filtered) {
        const key = fileDedupKey(file.name, file.size, file.lastModified);
        if (existingKeys.has(key)) {
          continue;
        }
        existingKeys.add(key);
        additions.push({
          id: `${key}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          file,
          queueStatus: "pending",
          queueError: "",
        });
      }

      return [...prev, ...additions];
    });
  }

  function removeUploadFile(uploadId) {
    setUploadFiles((prev) => prev.filter((entry) => entry.id !== uploadId));
  }

  async function uploadFromModal() {
    if (!uploadTemplateId.trim()) {
      addLog("Upload failed: select a template");
      return;
    }
    if (isUploadingDocuments) {
      return;
    }
    if (!uploadFiles.length) {
      addLog("Upload failed: choose one or more document files");
      return;
    }

    setExtractTemplateId(uploadTemplateId.trim());
    setImageFile(uploadFiles[0].file);

    setIsUploadingDocuments(true);
    try {
      for (const entry of uploadFiles) {
        setUploadFiles((prev) =>
          prev.map((row) =>
            row.id === entry.id
              ? { ...row, queueStatus: "processing", queueError: "" }
              : row,
          ),
        );

        try {
          await queueDocument(uploadTemplateId.trim(), entry.file);
          setUploadFiles((prev) =>
            prev.map((row) =>
              row.id === entry.id ? { ...row, queueStatus: "success" } : row,
            ),
          );
        } catch (error) {
          setUploadFiles((prev) =>
            prev.map((row) =>
              row.id === entry.id
                ? {
                    ...row,
                    queueStatus: "failed",
                    queueError: error.message || "Queue failed",
                  }
                : row,
            ),
          );
          addLog(`Queue failed for ${entry.file.name}: ${error.message}`);
        }
      }
      setActivePage("documents");
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  async function queueDocument(templateId, file) {
    const imagePreviewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null;
    if (imagePreviewUrl) {
      previewUrlsRef.current.add(imagePreviewUrl);
    }

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
    addLog(`Job queued: ${jobId} (${file.name})`);
    return jobId;
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

    setBusy(true);
    try {
      const jobId = await queueDocument(templateId, file);

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
      const nextDocumentId =
        documents.find((job) => String(job.job_id || "") !== targetDocumentId)
          ?.job_id || "";
      setSelectedDocumentId(nextDocumentId);
      if (nextDocumentId) {
        void loadJobDetails(nextDocumentId, { silent: true });
      }
      addLog(`Deleted document ${targetDocumentId}`);
    } catch (error) {
      if (Number(error?.status) === 404) {
        removeDocumentFromState(
          targetDocumentId,
          selectedDocument.image_preview_url,
        );
        const nextDocumentId =
          documents.find((job) => String(job.job_id || "") !== targetDocumentId)
            ?.job_id || "";
        setSelectedDocumentId(nextDocumentId);
        if (nextDocumentId) {
          void loadJobDetails(nextDocumentId, { silent: true });
        }
        addLog(`Document ${targetDocumentId} was already removed`);
        return;
      }
      addLog(`Delete document failed: ${error.message}`);
    } finally {
      setIsDeletingDocument(false);
    }
  }

  async function retrySelectedDocument() {
    if (!selectedDocument?.job_id) {
      addLog("Retry failed: select a document first");
      return;
    }
    if (isRetryingDocument) {
      return;
    }

    const currentStatus = String(selectedDocument.status || "").toLowerCase();
    if (currentStatus !== "failed" && currentStatus !== "retryable_failed") {
      addLog(`Retry skipped: document status is '${currentStatus || "unknown"}'`);
      return;
    }

    const targetDocumentId = String(selectedDocument.job_id || "").trim();
    setIsRetryingDocument(true);
    try {
      const data = await request(
        `/jobs/${encodeURIComponent(targetDocumentId)}/retry`,
        { method: "POST" },
      );
      upsertJobHistory(data);
      setSelectedDocumentId(targetDocumentId);
      addLog(`Retry queued for ${targetDocumentId} (attempt ${Number(data?.current_attempt || 0)})`);
    } catch (error) {
      addLog(`Retry failed: ${error.message}`);
    } finally {
      setIsRetryingDocument(false);
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
              {documents.map((job) => (
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
              {!documents.length ? (
                <p className="muted">
                  {debouncedDocumentSearch
                    ? "No documents match this search."
                    : "No documents uploaded yet."}
                </p>
              ) : null}
              {jobsHasMore ? (
                <button
                  type="button"
                  className="context-item"
                  disabled={isLoadingMoreJobs}
                  onClick={loadMoreJobs}
                >
                  <strong>
                    {isLoadingMoreJobs ? "Loading..." : "Load More Documents"}
                  </strong>
                  <span>
                    {debouncedDocumentSearch
                      ? "Continue searching older jobs"
                      : "Show older jobs"}
                  </span>
                </button>
              ) : null}
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
                  {workspace.connected ? <span>Connected</span> : null}
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
              disabled={activePage === "documents" && !hasApiAccess}
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
                disabled={isDeletingWorkspace || !workspaceId.trim()}
                onClick={deleteWorkspace}
              >
                {isDeletingWorkspace ? "Deleting..." : "Delete Workspace"}
              </button>
            ) : activePage === "templates" ? (
              <button
                type="button"
                className="danger"
                disabled={isDeletingTemplate || !hasApiAccess || !updateTemplateId.trim()}
                onClick={deleteTemplate}
              >
                {isDeletingTemplate ? "Deleting..." : "Delete Template"}
              </button>
            ) : activePage === "documents" ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    isRetryingDocument ||
                    !selectedDocument?.job_id ||
                    !["failed", "retryable_failed"].includes(
                      String(selectedDocument?.status || "").toLowerCase(),
                    )
                  }
                  onClick={retrySelectedDocument}
                >
                  {isRetryingDocument ? "Retrying..." : "Retry Document"}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={
                    isDeletingDocument || isRetryingDocument || !selectedDocument?.job_id
                  }
                  onClick={deleteSelectedDocument}
                >
                  {isDeletingDocument ? "Deleting..." : "Delete Document"}
                </button>
              </>
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
                    disabled={isSavingWorkspace || !isWorkspaceNameDirty}
                    onClick={saveWorkspaceChanges}
                  >
                    {isSavingWorkspace ? "Saving..." : "Save Changes"}
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
                    disabled={isSavingTemplate || !hasApiAccess}
                    onClick={
                      isEditingTemplate ? updateTemplate : createTemplate
                    }
                  >
                    {isSavingTemplate
                      ? "Saving..."
                      : isEditingTemplate
                        ? "Save Changes"
                        : "Save New Template"}
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
                  <ResultViewer
                    job={selectedDocument}
                    isLoading={
                      loadingDocumentDetailsId ===
                      String(selectedDocument.job_id || "")
                    }
                  />
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
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="upload-input-hidden"
                  multiple
                  onChange={(event) => {
                    appendUploadFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className={
                    isUploadDragActive
                      ? "upload-dropzone is-active"
                      : "upload-dropzone"
                  }
                  onClick={() => uploadInputRef.current?.click()}
                  onDragOver={handleUploadDragOver}
                  onDragLeave={handleUploadDragLeave}
                  onDrop={handleUploadDrop}
                >
                  <strong>Drag and drop files here</strong>
                  <span>
                    or click to browse multiple files (PNG, JPG, WEBP, PDF)
                  </span>
                  <em>
                    {uploadFiles.length
                      ? `${uploadFiles.length} file${uploadFiles.length === 1 ? "" : "s"} selected`
                      : "No files selected"}
                  </em>
                </button>
                {uploadFiles.length ? (
                  <div className="upload-file-list" role="list">
                    {uploadFiles.map((entry) => (
                      <div
                        className="upload-file-row"
                        role="listitem"
                        key={entry.id}
                      >
                        <span
                          className="upload-file-name"
                          title={entry.file.name}
                        >
                          {entry.file.name}
                        </span>
                        <div className="upload-file-actions">
                          <span
                            className={`status-pill ${queueStatusTone(entry.queueStatus)}`}
                          >
                            {entry.queueStatus}
                          </span>
                          {entry.queueStatus === "pending" ? (
                            <button
                              type="button"
                              className="ghost"
                              disabled={isUploadingDocuments}
                              onClick={() => removeUploadFile(entry.id)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        {entry.queueError ? (
                          <p className="hint upload-file-error">
                            {entry.queueError}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
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
                  disabled={isUploadingDocuments || !hasApiAccess}
                  onClick={uploadFromModal}
                >
                {isUploadingDocuments ? "Uploading..." : "Upload and Open Documents"}
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
  const currentAttempt = Number(job.current_attempt || 0);
  const completedAttempt = Number(job.completed_attempt || 0);
  const lastFailedAttempt = Number(job.last_failed_attempt || 0);
  const attemptLabel =
    currentAttempt > 0
      ? `Current attempt: ${currentAttempt}`
      : completedAttempt > 0
        ? `Completed on attempt: ${completedAttempt}`
        : lastFailedAttempt > 0
          ? `Last failed attempt: ${lastFailedAttempt}`
          : "Attempt: pending";

  return (
    <div className="job-status-stack">
      <div
        className={`job-status-skeleton ${
          isTerminal ? "is-terminal" : "is-processing"
        } ${isFailure ? "is-failed" : ""}`}
      >
        <span className="job-status-spinner" aria-hidden="true" />
        <div>
          <p>{statusLabel}</p>
          <p className="hint">{attemptLabel}</p>
        </div>
      </div>
    </div>
  );
}

function ResultViewer({ job, isLoading = false }) {
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
      ) : isLoading ? null : (
        <p className="muted">No result rows available yet.</p>
      )}
    </div>
  );
}

function renderAnswer(answer) {
  if (answer === null || answer === undefined) {
    return <p className="muted">No value extracted.</p>;
  }

  if (Array.isArray(answer)) {
    if (!answer.length) {
      return <p className="muted">No rows returned.</p>;
    }

    const allObjects = answer.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );

    if (allObjects) {
      const keys = Array.from(
        new Set(answer.flatMap((row) => Object.keys(row))),
      );

      return (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answer.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {keys.map((key) => (
                    <td key={`${key}-${rowIndex}`}>
                      {formatAnswerValue(row?.[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="kv-list">
        {answer.map((value, index) => (
          <div className="kv-row" key={index}>
            <span className="kv-key">{index}</span>
            <span className="kv-value">{formatAnswerValue(value)}</span>
          </div>
        ))}
      </div>
    );
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

function queueStatusTone(status) {
  if (status === "success") return "good";
  if (status === "failed") return "bad";
  return "pending";
}

function getDocumentSortTimestamp(job) {
  if (!job || typeof job !== "object") {
    return 0;
  }

  return Date.parse(job.created_at || job.queued_at || "") || 0;
}

function fileDedupKey(name, size, lastModified) {
  return `${name}::${size}::${lastModified}`;
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
          const sanitizedHeading = sanitizeFieldName(value).replace(
            /\s+/g,
            " ",
          );
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
                              Column Name
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
                              Column ID
                              <input
                                value={column.key}
                                readOnly
                                placeholder="auto_generated_from_name"
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
    heading: sanitizeFieldName(String(column?.heading || "")).replace(
      /\s+/g,
      " ",
    ),
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
