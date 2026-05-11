import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { createRuntimeAuthClient } from "./lib/authClient";
import {
  getAcceptWorkspaceInvitationTransition,
  getCancelWorkspaceInvitationTransition,
  getDeclineWorkspaceInvitationTransition,
  getInviteWorkspaceInvitationTransition,
  getLeaveWorkspaceTransition,
  getWorkspacePrimaryAction,
  getWorkspaceMemberActionTransition,
  getWorkspaceContextDisplay,
  resolveAcceptedWorkspaceContext,
  selectPendingWorkspaceInvitationContext,
  selectAcceptedWorkspaceContext,
} from "./lib/workspaceSelection";
import { getActionToast, getDocumentUploadToast } from "./lib/toastNotifications";
import { createCompletedDocumentCache } from "./lib/completedDocumentCache";

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

const ACCOUNT_PASSWORD_REQUIREMENTS = [
  { label: "At least 8 characters", test: (password) => password.length >= 8 },
  { label: "One uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { label: "One number", test: (password) => /[0-9]/.test(password) },
  {
    label: "One special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

function getSignUpErrorToastMessage(message) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("already") || normalized.includes("exists")) {
    return "An account already exists for this email. Sign in instead.";
  }
  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "Enter a valid email address and try again.";
  }
  return "Account creation failed. Please try again.";
}

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

const WORKSPACE_STORAGE_KEY = "documentextraction.workspace.v1";
const DEFAULT_WORKSPACE_ID = "workspace_local_default";
const DEFAULT_WORKSPACE_NAME = "Local Workspace";
const NEW_WORKSPACE_NAME = "New Workspace";
const DRAFT_TEMPLATE_NAV_ID = "__draft_template__";
const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);

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
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const workspaceId = String(parsed.workspaceId || "").trim();
    if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
      return null;
    }

    return {
      workspaceId,
      workspaceName: String(parsed.workspaceName || "").trim(),
    };
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
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authPasswordTouched, setAuthPasswordTouched] = useState(false);
  const [signUpSubmitAttempted, setSignUpSubmitAttempted] = useState(false);

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [apiKey, setApiKey] = useState("");

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
  const [showTemplateJsonModal, setShowTemplateJsonModal] = useState(false);
  const [templateJsonDraft, setTemplateJsonDraft] = useState("");
  const [templateJsonError, setTemplateJsonError] = useState("");
  const [templateJsonCopied, setTemplateJsonCopied] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
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
    [],
  );
  const [userWorkspaceInvitations, setUserWorkspaceInvitations] = useState(
    [],
  );
  const [workspaceResolutionStatus, setWorkspaceResolutionStatus] =
    useState("idle");
  const [selectedWorkspaceInvitationId, setSelectedWorkspaceInvitationId] =
    useState("");
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState([]);
  const [workspaceUserActionTarget, setWorkspaceUserActionTarget] =
    useState(null);
  const [isAcceptingWorkspaceInvitation, setIsAcceptingWorkspaceInvitation] =
    useState(false);
  const [isDecliningWorkspaceInvitation, setIsDecliningWorkspaceInvitation] =
    useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  const previewUrlsRef = useRef(new Set());
  const completedDocumentCacheRef = useRef(createCompletedDocumentCache());
  const isRecoveringForbiddenWorkspaceRef = useRef(false);
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
  const normalizedWorkspaceId = workspaceId.trim();
  const hasWorkspaceContext =
    workspaceResolutionStatus === "resolved" &&
    Boolean(normalizedWorkspaceId) &&
    normalizedWorkspaceId !== DEFAULT_WORKSPACE_ID;
  const hasApiAccess = hasSession && hasWorkspaceContext;
  const isWorkspaceContextLoading =
    hasSession &&
    (workspaceResolutionStatus === "idle" ||
      workspaceResolutionStatus === "loading");
  const hasWorkspaceResolutionError =
    hasSession && workspaceResolutionStatus === "error";
  const baseUrl = useMemo(() => apiBase.replace(/\/+$/, ""), [apiBase]);
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
  const unmetAccountPasswordRequirements = ACCOUNT_PASSWORD_REQUIREMENTS.filter(
    (requirement) => !requirement.test(authPassword),
  );
  const shouldShowAccountPasswordRequirements =
    authMode === "signup" && (authPasswordTouched || signUpSubmitAttempted);
  const hasSignUpPasswordMismatch =
    authMode === "signup" &&
    authConfirmPassword.length > 0 &&
    authPassword !== authConfirmPassword;

  const documents = useMemo(() => {
    const query = debouncedDocumentSearch.trim().toLowerCase();
    const historyIds = new Set(jobHistory.map((job) => job.job_id));
    const queuedOnly = Object.entries(queuedJobs)
      .filter(([jobId]) => !historyIds.has(jobId))
      .map(([jobId, meta]) => ({
        job_id: jobId,
        status: "queued",
        template_id: meta.template_id || extractTemplateId || "",
        source_name:
          meta.source_name || defaultUploadedName(meta.source_mime_type),
        source_preview_url: meta.source_preview_url || null,
        source_mime_type: meta.source_mime_type || null,
        queued_at: meta.queued_at || null,
        updated_at: meta.queued_at || null,
        results: [],
      }))
      .filter((job) => {
        if (!query) {
          return true;
        }

        return [job.job_id, job.source_name, job.template_id, job.status]
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

  const workspaceContextDisplay = useMemo(
    () =>
      getWorkspaceContextDisplay({
        apiBase,
        hasApiAccess,
        workspaceId,
        workspaceName,
        selectedWorkspaceInvitationId,
        userWorkspaces,
        userWorkspaceInvitations,
      }),
    [
      apiBase,
      hasApiAccess,
      selectedWorkspaceInvitationId,
      workspaceId,
      workspaceName,
      userWorkspaceInvitations,
      userWorkspaces,
    ],
  );
  const availableWorkspaces = workspaceContextDisplay.availableWorkspaces;
  const workspaceUserManagement =
    workspaceContextDisplay.workspaceSelectionView.userManagement;
  const canListWorkspaceUsers = Boolean(
    workspaceUserManagement?.canListWorkspaceUsers,
  );
  const canManageWorkspaceInvitations = Boolean(
    workspaceUserManagement?.canManageWorkspaceInvitations,
  );
  const selectedWorkspaceRole = String(
    userWorkspaces.find(
      (workspace) => String(workspace?.id || "") === String(workspaceId || ""),
    )?.role || "",
  );
  const selectedWorkspaceHasApiKey = Boolean(
    userWorkspaces.find(
      (workspace) => String(workspace?.id || "") === String(workspaceId || ""),
    )?.has_api_key,
  );
  const workspaceApiKeyActionLabel = selectedWorkspaceHasApiKey
    ? "Rotate API Key"
    : "Generate API Key";
  const workspaceApiKeyPlaceholder = selectedWorkspaceHasApiKey
    ? "Rotate API key to view again"
    : "Generate an API key to view";
  const canRotateWorkspaceApiKey = ["owner", "admin"].includes(
    selectedWorkspaceRole.trim().toLowerCase(),
  );
  const workspacePrimaryAction = getWorkspacePrimaryAction({
    workspaceRole: selectedWorkspaceRole,
  });

  function canShowWorkspaceUserAction(user) {
    const role = String(user?.role || "")
      .trim()
      .toLowerCase();
    if (role === "owner") {
      return Boolean(workspaceUserManagement?.canShowOwnerActions);
    }
    if (role === "admin") {
      return Boolean(workspaceUserManagement?.canShowAdminActions);
    }
    return Boolean(workspaceUserManagement?.canShowMemberActions);
  }

  const filteredWorkspaces = useMemo(() => {
    const query = workspaceSearch.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }

    return availableWorkspaces.filter((workspace) => {
      const searchable = [
        workspace.id,
        workspace.name,
        workspace.inviter_name,
        workspace.inviter_email,
        workspace.inviter_display,
        workspace.email,
        workspace.role,
      ].map((value) => String(value || "").toLowerCase());
      return searchable.some((value) => value.includes(query));
    });
  }, [availableWorkspaces, workspaceSearch]);

  const documentStatusMetrics = useMemo(() => {
    const metrics = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
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

  const selectedWorkspaceName = workspaceContextDisplay.selectedWorkspaceName;
  const activeWorkspaceName = workspaceContextDisplay.activeWorkspaceName;
  const effectiveSelectedWorkspaceInvitationId =
    workspaceContextDisplay.selectedWorkspaceInvitationId;
  const workspaceSelectionView = workspaceContextDisplay.workspaceSelectionView;
  const selectedWorkspaceInvitation = workspaceSelectionView.invitation;
  const isWorkspaceInvitationSelected =
    workspaceSelectionView.type === "invitation";
  const workspaceUserActionOptions = useMemo(() => {
    if (!workspaceUserActionTarget) {
      return [];
    }
    return getWorkspaceUserActions(
      workspaceUserManagement,
      String(workspaceUserActionTarget.role || ""),
    );
  }, [workspaceUserActionTarget, workspaceUserManagement]);

  const isWorkspaceNameDirty =
    Boolean(workspaceId.trim()) &&
    workspaceName.trim() !== selectedWorkspaceName.trim();

  function applyAcceptedWorkspaceContext(workspace) {
    const selection = selectAcceptedWorkspaceContext({
      workspace,
    });
    applyWorkspaceContextUpdate(selection);
    return selection;
  }

  function clearWorkspaceScopedData() {
    setTemplates([]);
    setExtractTemplateId("");
    setJobHistory([]);
    setQueuedJobs({});
    setJobsNextCursor(null);
    setJobsHasMore(false);
    setSelectedDocumentId("");
    setLastJobId("");
    setLatestResponse(null);
    setWorkspaceUsers([]);
    setWorkspaceInvitations([]);
  }

  function applyWorkspaceContextUpdate(nextWorkspaceContext) {
    if (!nextWorkspaceContext) {
      return null;
    }

    const nextWorkspaceId = Object.prototype.hasOwnProperty.call(
      nextWorkspaceContext,
      "workspaceId",
    )
      ? String(nextWorkspaceContext.workspaceId || "")
      : workspaceId;
    if (String(nextWorkspaceId || "") !== String(workspaceId || "")) {
      if (String(workspaceId || "")) {
        completedDocumentCacheRef.current.clearAll();
      }
      clearWorkspaceScopedData();
    }

    if (
      Object.prototype.hasOwnProperty.call(nextWorkspaceContext, "workspaceId")
    ) {
      setWorkspaceId(nextWorkspaceContext.workspaceId);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextWorkspaceContext,
        "workspaceName",
      )
    ) {
      setWorkspaceName(nextWorkspaceContext.workspaceName);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        nextWorkspaceContext,
        "selectedWorkspaceInvitationId",
      )
    ) {
      setSelectedWorkspaceInvitationId(
        nextWorkspaceContext.selectedWorkspaceInvitationId,
      );
    }
    if (Object.prototype.hasOwnProperty.call(nextWorkspaceContext, "apiKey")) {
      setApiKey(nextWorkspaceContext.apiKey);
    }

    return nextWorkspaceContext;
  }

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

    if (hasSession && workspaceResolutionStatus !== "resolved") {
      return;
    }

    const storedWorkspaceId = workspaceId.trim();
    if (!storedWorkspaceId || storedWorkspaceId === DEFAULT_WORKSPACE_ID) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return;
    }

    const payload = {
      workspaceId: storedWorkspaceId,
      workspaceName,
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
  }, [
    hasSession,
    workspaceResolutionStatus,
    workspaceName,
    workspaceId,
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

  function showActionToast(action, outcome, options) {
    const notification = getActionToast(action, outcome, options);
    toast[notification.severity](notification.message);
  }

  function showNotification(notification) {
    toast[notification.severity](notification.message);
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
      if (hasSession) {
        if (workspaceRequired) {
          if (!workspaceId.trim()) {
            throw new Error("Workspace ID is required");
          }
          headers.set("x-workspace-id", workspaceId.trim());
        }
      } else {
        throw new Error("Sign in to continue");
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
      if (response.status === 403 && authRequired && workspaceRequired) {
        await recoverForbiddenWorkspaceAccess();
      }
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
        source_name:
          queuedMeta?.source_name ||
          existing?.source_name ||
          job.source_name ||
          null,
        source_preview_url:
          queuedMeta?.source_preview_url ||
          existing?.source_preview_url ||
          job.source_preview_url ||
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

    if (["completed", "failed"].includes(job.status)) {
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

  async function copyWorkspaceApiKeyToClipboard(keyMaterial) {
    if (!navigator.clipboard?.writeText) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(keyMaterial);
      return true;
    } catch {
      return false;
    }
  }

  async function rotateWorkspaceApiKey(targetWorkspaceId = workspaceId) {
    const wasRotation = selectedWorkspaceHasApiKey;
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
    setUserWorkspaces((prev) =>
      prev.map((workspace) =>
        String(workspace?.id || "") === String(data.workspace_id || targetWorkspaceId)
          ? { ...workspace, has_api_key: true }
          : workspace,
      ),
    );
    const copied = data.api_key
      ? await copyWorkspaceApiKeyToClipboard(String(data.api_key))
      : false;
    addLog(
      `API key rotated for workspace: ${data.workspace_id || targetWorkspaceId}`,
    );
    showActionToast(
      wasRotation
        ? copied
          ? "workspace.apiKey.rotate.copied"
          : "workspace.apiKey.rotate.manualCopy"
        : copied
          ? "workspace.apiKey.generate.copied"
          : "workspace.apiKey.generate.manualCopy",
      "success",
      data,
    );
    return data;
  }

  async function copyVisibleWorkspaceApiKey() {
    if (!apiKey) {
      return;
    }
    await copyWorkspaceApiKeyToClipboard(apiKey);
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
      if (String(data.workspace_id || "") !== String(workspaceId || "")) {
        completedDocumentCacheRef.current.clearAll();
        clearWorkspaceScopedData();
      }
      setWorkspaceId(data.workspace_id || "");
      setWorkspaceName(data.name || NEW_WORKSPACE_NAME);
      setApiKey("");
      if (!silent) {
        addLog(`Workspace created: ${data.workspace_id || "unknown"}`);
        showActionToast("workspace.create", "success", {
          targetName: data.name || nameForCreate,
        });
      }
      await listWorkspaces();
    } catch (error) {
      addLog(`Create workspace failed: ${error.message}`);
      if (!silent) {
        showActionToast("workspace.create", "failure", { error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshApiKey() {
    if (!hasWorkspaceContext) {
      addLog("Refresh API key failed: select or create a workspace first");
      return;
    }

    const targetWorkspaceId = normalizedWorkspaceId;
    if (
      selectedWorkspaceHasApiKey &&
      !window.confirm(
        "Rotate this Workspace API key? Existing external clients using the current key will stop working.",
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      await rotateWorkspaceApiKey(targetWorkspaceId);
    } catch (error) {
      addLog(`Refresh API key failed: ${error.message}`);
      showActionToast("workspace.apiKey.rotate", "failure", { error });
    } finally {
      setBusy(false);
    }
  }

  async function listWorkspaces() {
    if (!hasSession) {
      return;
    }

    try {
      const [workspaceData, invitationData] = await Promise.all([
        request("/workspaces", { method: "GET" }, true, false),
        request("/invitations", { method: "GET" }, true, false),
      ]);
      const workspaces = Array.isArray(workspaceData?.workspaces)
        ? workspaceData.workspaces
        : [];
      const invitations = Array.isArray(invitationData?.invitations)
        ? invitationData.invitations
        : [];
      setUserWorkspaces(workspaces);
      setUserWorkspaceInvitations(invitations);
      const resolution = resolveAcceptedWorkspaceContext({
        storedWorkspacePreference: workspaceId.trim()
          ? { workspaceId, workspaceName }
          : initialWorkspaceRef.current,
        userWorkspaces: workspaces,
        userWorkspaceInvitations: invitations,
      });
      applyWorkspaceContextUpdate(resolution.nextWorkspaceContext);
      setWorkspaceResolutionStatus(resolution.type === "resolved" ? "resolved" : "error");
      return { workspaces, invitations, resolution };
    } catch (error) {
      addLog(`List workspaces failed: ${error.message}`);
      setWorkspaceResolutionStatus("error");
      throw error;
    }
  }

  function retryWorkspaceResolution() {
    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
  }

  async function recoverForbiddenWorkspaceAccess() {
    if (isRecoveringForbiddenWorkspaceRef.current) {
      return;
    }

    isRecoveringForbiddenWorkspaceRef.current = true;
    try {
      const refresh = await listWorkspaces();
      const nextWorkspace = refresh?.resolution?.workspace;
      if (nextWorkspace?.id) {
        showActionToast("workspace.access.changed", "success", {
          targetName: nextWorkspace.name || nextWorkspace.id,
        });
      }
    } catch {
      // listWorkspaces already records the retryable resolution failure.
    } finally {
      isRecoveringForbiddenWorkspaceRef.current = false;
    }
  }

  async function listWorkspaceUsers(targetWorkspaceId = workspaceId) {
    const normalizedWorkspaceId = String(targetWorkspaceId || "").trim();
    if (!hasSession || !normalizedWorkspaceId || !canListWorkspaceUsers) {
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

  async function listWorkspaceInvitations(targetWorkspaceId = workspaceId) {
    const normalizedWorkspaceId = String(targetWorkspaceId || "").trim();
    if (
      !hasSession ||
      !normalizedWorkspaceId ||
      !canManageWorkspaceInvitations
    ) {
      setWorkspaceInvitations([]);
      return;
    }

    try {
      const data = await request(
        `/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/invitations`,
        { method: "GET" },
        true,
        false,
      );
      setWorkspaceInvitations(
        Array.isArray(data?.invitations) ? data.invitations : [],
      );
    } catch (error) {
      setWorkspaceInvitations([]);
      addLog(`List workspace invitations failed: ${error.message}`);
    }
  }

  async function applyWorkspaceUserAction(targetUserId, action) {
    const transition = getWorkspaceMemberActionTransition({
      workspaceId,
      targetUserId,
      action,
    });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("User update failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_target_workspace_user") {
      return;
    }
    const targetWorkspaceUser = workspaceUsers.find(
      (user) => String(user?.user_id || "").trim() === String(targetUserId || "").trim(),
    );
    const targetDisplay =
      String(targetWorkspaceUser?.name || "").trim() ||
      String(targetWorkspaceUser?.email || "").trim() ||
      String(targetUserId || "").trim();
    const actionToast = getWorkspaceMemberActionToastAction(action);

    setBusy(true);
    try {
      const data = await request(
        transition.request.path,
        {
          method: transition.request.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(transition.request.body),
        },
        true,
        false,
      );
      const workspaces = await listWorkspaces();
      const successTransition = getWorkspaceMemberActionTransition({
        workspaceId,
        targetUserId,
        action,
        actionResult: data || {},
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      if (successTransition.refresh.includes("workspaceUsers")) {
        await listWorkspaceUsers(successTransition.workspaceId);
      }
      showActionToast(actionToast, "success", { targetName: targetDisplay });
      addLog(`User updated (${successTransition.action.replace(/_/g, " ")})`);
    } catch (error) {
      getWorkspaceMemberActionTransition({
        workspaceId,
        targetUserId,
        action,
        actionError: error,
      });
      showActionToast(actionToast, "failure", { error });
      addLog(`User update failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function inviteUser() {
    const transition = getInviteWorkspaceInvitationTransition({
      workspaceId,
      email: inviteEmail,
      role: inviteRole,
    });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Invite failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_invitation_email") {
      showActionToast("workspaceInvitation.create", "validation", {
        reason: "email",
      });
      addLog("Invite failed: email is required");
      return;
    }

    setBusy(true);
    try {
      const data = await request(transition.request.path, {
        method: transition.request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transition.request.body),
      });
      const successTransition = getInviteWorkspaceInvitationTransition({
        workspaceId,
        email: inviteEmail,
        role: inviteRole,
        inviteResult: data || {},
      });
      showActionToast("workspaceInvitation.create", "success", {
        targetEmail: successTransition.email,
      });
      addLog(`Invitation sent to ${successTransition.email}`);
      setInviteEmail("");
      if (successTransition.refresh.includes("pendingWorkspaceInvitations")) {
        await listWorkspaceInvitations(successTransition.workspaceId);
      }
    } catch (error) {
      getInviteWorkspaceInvitationTransition({
        workspaceId,
        email: inviteEmail,
        role: inviteRole,
        inviteError: error,
      });
      showActionToast("workspaceInvitation.create", "failure", { error });
      addLog(`Invite failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelWorkspaceInvitation(invitation) {
    const transition = getCancelWorkspaceInvitationTransition({
      workspaceId,
      invitation,
    });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Cancel invitation failed: select a workspace first");
      return;
    }
    if (transition.reason === "missing_pending_workspace_invitation") {
      addLog("Cancel invitation failed: select a pending invitation first");
      return;
    }
    if (
      transition.requiresConfirmation &&
      !window.confirm(transition.confirmationMessage)
    ) {
      return;
    }
    const requestTransition = getCancelWorkspaceInvitationTransition({
      workspaceId,
      invitation,
      confirmed: true,
    });

    setBusy(true);
    try {
      const data = await request(
        requestTransition.request.path,
        { method: requestTransition.request.method },
        true,
        false,
      );
      const successTransition = getCancelWorkspaceInvitationTransition({
        workspaceId,
        invitation,
        cancelResult: data || {},
      });
      if (successTransition.refresh.includes("pendingWorkspaceInvitations")) {
        await listWorkspaceInvitations(successTransition.workspaceId);
      }
      showActionToast("workspaceInvitation.cancel", "success", {
        targetEmail: successTransition.invitationEmail,
      });
      addLog(`Invitation cancelled for ${successTransition.invitationEmail}`);
    } catch (error) {
      getCancelWorkspaceInvitationTransition({
        workspaceId,
        invitation,
        cancelError: error,
      });
      showActionToast("workspaceInvitation.cancel", "failure", { error });
      addLog(`Cancel invitation failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function acceptSelectedWorkspaceInvitation() {
    const transition = getAcceptWorkspaceInvitationTransition({
      selectedWorkspaceInvitation,
    });
    if (transition.reason === "missing_selected_workspace_invitation") {
      addLog("Accept invitation failed: select a pending invitation first");
      return;
    }
    if (transition.reason === "selected_workspace_invitation_not_pending") {
      addLog(
        "Accept invitation failed: only pending invitations can be accepted",
      );
      return;
    }

    setIsAcceptingWorkspaceInvitation(true);
    try {
      const data = await request(
        transition.request.path,
        { method: transition.request.method },
        true,
        false,
      );
      const workspaces = await listWorkspaces();
      const successTransition = getAcceptWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        acceptResult: data,
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      showActionToast("workspaceInvitation.accept", "success");
      addLog(
        `Invitation accepted for workspace ${successTransition.acceptedWorkspaceId || "unknown"}`,
      );
    } catch (error) {
      const failureTransition = getAcceptWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        acceptError: error,
      });
      if (failureTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(failureTransition.nextWorkspaceContext);
      }
      showActionToast("workspaceInvitation.accept", "failure", { error });
      addLog(`Accept invitation failed: ${error.message}`);
    } finally {
      setIsAcceptingWorkspaceInvitation(false);
    }
  }

  async function declineSelectedWorkspaceInvitation() {
    const transition = getDeclineWorkspaceInvitationTransition({
      selectedWorkspaceInvitation,
    });
    if (transition.reason === "missing_selected_workspace_invitation") {
      addLog("Decline invitation failed: select a pending invitation first");
      return;
    }
    if (transition.reason === "selected_workspace_invitation_not_pending") {
      addLog(
        "Decline invitation failed: only pending invitations can be declined",
      );
      return;
    }

    setIsDecliningWorkspaceInvitation(true);
    try {
      await request(
        transition.request.path,
        { method: transition.request.method },
        true,
        false,
      );
      const successTransition = getDeclineWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        declineResult: {},
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      await listWorkspaces();
      showActionToast("workspaceInvitation.decline", "success");
      addLog(
        `Invitation declined for ${selectedWorkspaceInvitation.workspaceName || "workspace"}`,
      );
    } catch (error) {
      getDeclineWorkspaceInvitationTransition({
        selectedWorkspaceInvitation,
        declineError: error,
      });
      showActionToast("workspaceInvitation.decline", "failure", { error });
      addLog(`Decline invitation failed: ${error.message}`);
    } finally {
      setIsDecliningWorkspaceInvitation(false);
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
      showActionToast("workspace.rename", "success", {
        targetName: workspaceName.trim(),
      });
    } catch (error) {
      addLog(`Save changes failed: ${error.message}`);
      showActionToast("workspace.rename", "failure", { error });
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
      completedDocumentCacheRef.current.clearAll();
      setWorkspaceId("");
      setWorkspaceName("");
      setApiKey("");
      await listWorkspaces();
      addLog("Workspace deleted");
      showActionToast("workspace.delete", "success");
    } catch (error) {
      addLog(`Delete workspace failed: ${error.message}`);
      showActionToast("workspace.delete", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  async function leaveWorkspace() {
    const transition = getLeaveWorkspaceTransition({ workspaceId });
    if (transition.reason === "missing_accepted_workspace_context") {
      addLog("Leave workspace failed: select a workspace first");
      return;
    }
    if (isDeletingWorkspace) {
      return;
    }

    const confirmed = window.confirm(transition.confirmationMessage);
    if (!confirmed) {
      return;
    }

    const requestTransition = getLeaveWorkspaceTransition({
      workspaceId,
      confirmed: true,
    });
    setIsDeletingWorkspace(true);
    try {
      const data = await request(
        requestTransition.request.path,
        { method: requestTransition.request.method },
        true,
        false,
      );
      const leftWorkspaceId = requestTransition.workspaceId;
      const workspaces = await listWorkspaces();
      const successTransition = getLeaveWorkspaceTransition({
        workspaceId: leftWorkspaceId,
        leaveResult: data,
        refreshedUserWorkspaces: workspaces,
      });
      if (successTransition.nextWorkspaceContext) {
        applyWorkspaceContextUpdate(successTransition.nextWorkspaceContext);
      }
      addLog("Workspace left");
      showActionToast("workspace.leave", "success", {
        replacementPersonalWorkspaceCreated: Boolean(
          data?.replacement_workspace,
        ),
      });
    } catch (error) {
      getLeaveWorkspaceTransition({ workspaceId, leaveError: error });
      addLog(`Leave workspace failed: ${error.message}`);
      showActionToast("workspace.leave", "failure", { error });
    } finally {
      setIsDeletingWorkspace(false);
    }
  }

  function runWorkspacePrimaryAction() {
    if (workspacePrimaryAction.type === "leave") {
      leaveWorkspace();
      return;
    }
    deleteWorkspace();
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword.trim()) {
      addLog("Sign in failed: email and password are required");
      toast.error("Email and password are required.");
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
      toast.error(
        "Sign in failed. Check your email and password and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    setSignUpSubmitAttempted(true);
    const missingSignUpFields = [];
    if (!authName.trim()) missingSignUpFields.push("Name");
    if (!authEmail.trim()) missingSignUpFields.push("email");
    if (!authPassword.trim()) missingSignUpFields.push("password");
    if (!authConfirmPassword.trim()) {
      missingSignUpFields.push("confirm password");
    }
    if (missingSignUpFields.length > 0) {
      const lastField = missingSignUpFields[missingSignUpFields.length - 1];
      const leadingFields = missingSignUpFields.slice(0, -1);
      const fieldList =
        leadingFields.length === 0
          ? lastField
          : leadingFields.length === 1
            ? `${leadingFields[0]} and ${lastField}`
            : `${leadingFields.join(", ")}, and ${lastField}`;
      const requiredVerb = missingSignUpFields.length === 1 ? "is" : "are";
      const displayFieldList = fieldList[0].toUpperCase() + fieldList.slice(1);
      addLog(`Sign up failed: ${fieldList} required`);
      toast.error(`${displayFieldList} ${requiredVerb} required.`);
      return;
    }
    if (unmetAccountPasswordRequirements.length > 0) {
      addLog("Sign up failed: password does not meet complexity requirements");
      toast.error("Password must meet all complexity requirements.");
      return;
    }
    if (hasSignUpPasswordMismatch) {
      addLog("Sign up failed: passwords do not match");
      toast.error("Passwords do not match.");
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
      setAuthConfirmPassword("");
      await refetchSession();
      addLog(`Account created for ${authEmail.trim()}`);
    } catch (error) {
      addLog(`Sign up failed: ${error.message}`);
      toast.error(getSignUpErrorToastMessage(error.message));
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
      toast.error("Google sign-in could not start. Please try again.");
      setBusy(false);
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    if (authMode === "signin") {
      await signIn();
      return;
    }
    await signUp();
  }

  function switchAuthMode(nextMode) {
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthPasswordTouched(false);
    setSignUpSubmitAttempted(false);
  }

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
      completedDocumentCacheRef.current.clearAll();
      setApiKey("");
      setWorkspaceId("");
      setTemplates([]);
      setJobHistory([]);
      setUserWorkspaces([]);
      setUserWorkspaceInvitations([]);
      setSelectedWorkspaceInvitationId("");
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
  }, [hasApiAccess, workspaceId]);

  useEffect(() => {
    if (!hasApiAccess) {
      return;
    }

    void listJobs();
  }, [debouncedDocumentSearch, hasApiAccess, workspaceId]);

  useEffect(() => {
    if (!hasSession) {
      setWorkspaceResolutionStatus("idle");
      return;
    }

    setWorkspaceResolutionStatus("loading");
    void listWorkspaces().catch(() => {});
    void loadProfile();
  }, [hasSession]);

  useEffect(() => {
    if (!hasSession || !workspaceId.trim()) {
      setWorkspaceUsers([]);
      setWorkspaceInvitations([]);
      return;
    }

    void listWorkspaceUsers(workspaceId.trim());
    void listWorkspaceInvitations(workspaceId.trim());
  }, [
    canListWorkspaceUsers,
    canManageWorkspaceInvitations,
    hasSession,
    workspaceId,
  ]);

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
      const data = await request(query ? `/jobs?${query}` : "/jobs", {
        method: "GET",
      });
      const list = Array.isArray(data?.jobs) ? data.jobs : [];
      const isFilteredList = Boolean(search);
      const hydratedList = list.map((job) => {
        if (String(job?.status || "") !== "completed") {
          return job;
        }
        const cached = completedDocumentCacheRef.current.get(workspaceId, job.job_id);
        return cached ? { ...job, ...cached } : job;
      });
      if (!append && !data?.has_more) {
        completedDocumentCacheRef.current.pruneFromJobList(workspaceId, list, {
          filtered: isFilteredList,
        });
      }
      setJobHistory((prev) => {
        if (!append) {
          return hydratedList;
        }

        const seen = new Set(prev.map((job) => String(job.job_id || "")));
        const additions = hydratedList.filter((job) => {
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
      if (!selectedDocumentId && hydratedList[0]?.job_id) {
        setSelectedDocumentId(String(hydratedList[0].job_id));
      }
      addLog(
        `${append ? "Loaded" : "Loaded"} ${list.length} document${list.length === 1 ? "" : "s"}${search ? ` matching "${search}"` : ""}`,
      );
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

  async function loadJobDetails(
    jobId,
    { silent = true, showLoading = false } = {},
  ) {
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
      completedDocumentCacheRef.current.store(workspaceId, data);
    } catch (error) {
      if (Number(error?.status) === 404) {
        completedDocumentCacheRef.current.remove(workspaceId, normalizedJobId);
        removeDocumentFromState(normalizedJobId);
      }
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

    void loadJobDetails(selectedDocumentId, {
      silent: true,
      showLoading: true,
    });
  }, [hasApiAccess, selectedDocumentId]);

  useEffect(() => {
    if (!hasApiAccess || !selectedDocumentId.trim()) {
      return;
    }

    const liveStatus = String(selectedDocument?.status || "").toLowerCase();
    if (!LIVE_DOCUMENT_STATUSES.has(liveStatus)) {
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
      setExtractTemplateId(data.template_id);
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
        setExtractTemplateId(data.template_id);
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
        setExtractTemplateId("");
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
      "Extract medication and prescription fields from a Document",
    );
    setTemplateFields(DEFAULT_FIELDS.map((field) => ({ ...field })));
    setLoadedTemplateSnapshot(null);
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
      showActionToast("document.upload", "validation", { reason: "template" });
      return;
    }
    if (isUploadingDocuments) {
      return;
    }
    if (!uploadFiles.length) {
      addLog("Upload failed: choose one or more document files");
      showActionToast("document.upload", "validation", { reason: "files" });
      return;
    }

    setExtractTemplateId(uploadTemplateId.trim());
    setImageFile(uploadFiles[0].file);

    setIsUploadingDocuments(true);
    try {
      let queuedCount = 0;
      let failedCount = 0;

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
          queuedCount += 1;
          setUploadFiles((prev) =>
            prev.map((row) =>
              row.id === entry.id ? { ...row, queueStatus: "success" } : row,
            ),
          );
        } catch (error) {
          failedCount += 1;
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
      showNotification(
        getDocumentUploadToast({ queued: queuedCount, failed: failedCount }),
      );
      setActivePage("documents");
    } finally {
      setIsUploadingDocuments(false);
    }
  }

  async function queueDocument(templateId, file) {
    const sourcePreviewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : null;
    if (sourcePreviewUrl) {
      previewUrlsRef.current.add(sourcePreviewUrl);
    }

    const formData = new FormData();
    formData.append("template_id", templateId.trim());
    formData.append("document", file);
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
        source_name: file.name,
        source_preview_url: sourcePreviewUrl,
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
      addLog(
        "Extract failed: choose a Document source file (PNG, JPEG, WebP, or PDF)",
      );
      return;
    }

    setBusy(true);
    try {
      const jobId = await queueDocument(templateId, file);

      const finalJob = await pollJobUntilFinished(jobId);
      setLatestResponse(finalJob);
      upsertJobHistory(finalJob);
      if (finalJob.status === "failed") {
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
      if (data.status === "failed") {
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
      if (data.status === "failed") {
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
      if (["completed", "failed"].includes(data.status)) {
        return data;
      }
      addLog(`Polling job ${jobId} (${attempt}/30): ${data.status}`);
      await sleep(2000);
    }
    throw new Error("Timed out waiting for job completion");
  }

  function removeDocumentFromState(targetDocumentId, sourcePreviewUrl) {
    if (sourcePreviewUrl) {
      URL.revokeObjectURL(sourcePreviewUrl);
      previewUrlsRef.current.delete(sourcePreviewUrl);
    }
    completedDocumentCacheRef.current.remove(workspaceId, targetDocumentId);

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
    const targetDocumentName = selectedDocument.source_name || targetDocumentId;
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
        selectedDocument.source_preview_url,
      );
      const nextDocumentId =
        documents.find((job) => String(job.job_id || "") !== targetDocumentId)
          ?.job_id || "";
      setSelectedDocumentId(nextDocumentId);
      if (nextDocumentId) {
        void loadJobDetails(nextDocumentId, { silent: true });
      }
      addLog(`Deleted document ${targetDocumentId}`);
      showActionToast("document.delete", "success", {
        targetName: targetDocumentName,
      });
    } catch (error) {
      if (Number(error?.status) === 404) {
        removeDocumentFromState(
          targetDocumentId,
          selectedDocument.source_preview_url,
        );
        const nextDocumentId =
          documents.find((job) => String(job.job_id || "") !== targetDocumentId)
            ?.job_id || "";
        setSelectedDocumentId(nextDocumentId);
        if (nextDocumentId) {
          void loadJobDetails(nextDocumentId, { silent: true });
        }
        addLog(`Document ${targetDocumentId} was already removed`);
        showActionToast("document.delete", "alreadyRemoved", {
          targetName: targetDocumentName,
        });
        return;
      }
      addLog(`Delete document failed: ${error.message}`);
      showActionToast("document.delete", "failure");
    } finally {
      setIsDeletingDocument(false);
    }
  }

  if (isSessionPending) {
    return null;
  }

  if (!hasSession) {
    return (
      <>
        <Toaster richColors />
        <div className="auth-shell">
          <section className="auth-card">
            <div className="auth-header">
              <p className="eyebrow">Document Extraction</p>
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

            <form className="panel auth-panel" onSubmit={submitAuthForm}>
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
                    aria-invalid={hasSignUpPasswordMismatch}
                    className={
                      hasSignUpPasswordMismatch ? "auth-input-error" : ""
                    }
                    onChange={(event) => {
                      setAuthPassword(event.target.value);
                      if (authMode === "signup") {
                        setAuthPasswordTouched(true);
                      }
                    }}
                    placeholder="************"
                  />
                </label>
                {authMode === "signup" ? (
                  <label>
                    Confirm Password
                    <input
                      type="password"
                      value={authConfirmPassword}
                      aria-invalid={hasSignUpPasswordMismatch}
                      className={
                        hasSignUpPasswordMismatch ? "auth-input-error" : ""
                      }
                      onChange={(event) =>
                        setAuthConfirmPassword(event.target.value)
                      }
                      placeholder="Repeat password"
                    />
                  </label>
                ) : null}
              </div>
              {hasSignUpPasswordMismatch ? (
                <p className="auth-password-mismatch">
                  Passwords do not match.
                </p>
              ) : null}
              {shouldShowAccountPasswordRequirements &&
              unmetAccountPasswordRequirements.length > 0 ? (
                <ul className="auth-password-requirements">
                  {unmetAccountPasswordRequirements.map((requirement) => (
                    <li key={requirement.label}>{requirement.label}</li>
                  ))}
                </ul>
              ) : null}
              {authMode === "signin" ? (
                <>
                  <button
                    type="submit"
                    className="auth-primary-action"
                    disabled={busy}
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
                          switchAuthMode("signup");
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
                    type="submit"
                    className="auth-primary-action"
                    disabled={busy}
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
                          switchAuthMode("signin");
                        }
                      }}
                    >
                      Sign In
                    </a>
                  </p>
                </>
              )}
            </form>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster richColors />
      <div className="app-frame">
        <aside className="left-sidebar">
          <div className="sidebar-brand">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.id === activePage
                    ? "sidebar-link active"
                    : "sidebar-link"
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
            disabled={busy || !workspaceSelectionView.hasWorkspaceApiAccess}
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
                  placeholder="Job ID or Source file"
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
                      {job.source_name ||
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
                {isWorkspaceContextLoading ? (
                  <p className="muted">Loading workspace context</p>
                ) : hasWorkspaceResolutionError ? (
                  <>
                    <p className="muted">Workspace resolution error</p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={retryWorkspaceResolution}
                    >
                      Retry Workspaces
                    </button>
                  </>
                ) : filteredWorkspaces.map((workspace) => (
                  <button
                    type="button"
                    key={
                      workspace.type === "invitation"
                        ? `workspace-invitation-${workspace.invitation_id}`
                        : `workspace-${workspace.id}`
                    }
                    className={[
                      "context-item context-item-workspace",
                      workspace.type === "invitation" ? "invited" : "",
                      workspace.type === "invitation"
                        ? workspace.invitation_id ===
                          effectiveSelectedWorkspaceInvitationId
                          ? "active"
                          : ""
                        : workspace.id ===
                              (workspaceId || DEFAULT_WORKSPACE_ID) &&
                            !effectiveSelectedWorkspaceInvitationId
                          ? "active"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (workspace.type === "invitation") {
                        applyWorkspaceContextUpdate(
                          selectPendingWorkspaceInvitationContext({
                            invitation: { id: workspace.invitation_id },
                          }),
                        );
                        setActivePage("workspace");
                        addLog(
                          `Selected invitation for workspace ${workspace.id}`,
                        );
                        return;
                      }

                      applyAcceptedWorkspaceContext(workspace);
                      addLog(`Switched workspace context to ${workspace.id}`);
                    }}
                  >
                    <strong>{workspace.name}</strong>
                    <span>{workspace.id}</span>
                    {workspace.type === "invitation" ? (
                      <span className="workspace-invited-meta">
                        Invited as {formatRoleLabel(workspace.role)}
                      </span>
                    ) : null}
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
                <span className="status-chip">
                  Templates {templates.length}
                </span>
                <span className="status-chip good">
                  {isEditingTemplate ? "Editing" : "Draft"}
                </span>
              </>
            ) : (
              <>
                <span className="status-chip">
                  Workspaces {isWorkspaceContextLoading || hasWorkspaceResolutionError ? 0 : availableWorkspaces.length}
                </span>
                <span
                  className={`status-chip ${
                    workspaceSelectionView.hasWorkspaceApiAccess
                      ? "good"
                      : "warn"
                  }`}
                >
                  {isWorkspaceContextLoading
                    ? "Loading"
                    : hasWorkspaceResolutionError
                      ? "Resolution Error"
                      : isWorkspaceInvitationSelected
                    ? "Invitation Pending"
                    : `API ${
                        workspaceSelectionView.hasWorkspaceApiAccess
                          ? "Ready"
                          : "Missing"
                      }`}
                </span>
              </>
            )}
          </div>
        </aside>

        <main className="main-content">
          <section className="workspace-toolbar" aria-label="Workspace toolbar">
            <div className="workspace-toolbar-meta">
              <span className="status-chip">
                Workspace {isWorkspaceContextLoading
                  ? "Loading workspace context"
                  : hasWorkspaceResolutionError
                    ? "Workspace resolution error"
                    : workspaceSelectionView.workspaceName}
              </span>
              {isWorkspaceInvitationSelected ? (
                <>
                  <span className="status-chip warn">Invitation Pending</span>
                  <span className="status-chip warn">API Locked</span>
                </>
              ) : (
                <>
                  <span
                    className={`status-chip ${
                      workspaceSelectionView.hasWorkspaceApiAccess
                        ? "good"
                        : "warn"
                    }`}
                  >
                    API{" "}
                    {workspaceSelectionView.hasWorkspaceApiAccess
                      ? "Ready"
                      : "Missing Access"}
                  </span>
                  <span className="status-chip">Jobs {documents.length}</span>
                </>
              )}
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
              {activePage === "workspace" && !isWorkspaceInvitationSelected ? (
                <button
                  type="button"
                  className="danger"
                  disabled={
                    isDeletingWorkspace ||
                    !hasApiAccess ||
                    !workspaceId.trim() ||
                    workspacePrimaryAction.type === "none"
                  }
                  onClick={runWorkspacePrimaryAction}
                >
                  {isDeletingWorkspace
                    ? workspacePrimaryAction.type === "leave"
                      ? "Leaving..."
                      : "Deleting..."
                    : workspacePrimaryAction.label || "Workspace Action"}
                </button>
              ) : activePage === "templates" ? (
                <button
                  type="button"
                  className="danger"
                  disabled={
                    isDeletingTemplate ||
                    !hasApiAccess ||
                    !updateTemplateId.trim()
                  }
                  onClick={deleteTemplate}
                >
                  {isDeletingTemplate ? "Deleting..." : "Delete Template"}
                </button>
              ) : activePage === "documents" ? (
                <button
                  type="button"
                  className="danger"
                  disabled={isDeletingDocument || !selectedDocument?.job_id}
                  onClick={deleteSelectedDocument}
                >
                  {isDeletingDocument ? "Deleting..." : "Delete Document"}
                </button>
              ) : null}
            </div>
          </section>

          {!isWorkspaceInvitationSelected ? (
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
                <p className="kpi-value">{documentStatusMetrics.failed}</p>
                <p className="kpi-meta">Terminal failed jobs</p>
              </article>
            </section>
          ) : null}

          {activePage === "workspace" ? (
            isWorkspaceInvitationSelected && selectedWorkspaceInvitation ? (
              <>
                <header className="page-header invitation-page-header">
                  <p className="eyebrow">Workspace Invitation</p>
                  <h2>{selectedWorkspaceInvitation.workspaceName}</h2>
                  <p>
                    This invitation is a pending offer. You do not have
                    workspace access until you accept it.
                  </p>
                </header>

                <section className="content-grid invitation-detail-grid">
                  <article className="workspace-card invitation-detail-card">
                    <div className="workspace-head">
                      <h2>Pending Invitation</h2>
                      <p>
                        Review who invited you and what role you will receive
                        before accepting or declining.
                      </p>
                    </div>

                    <dl className="invitation-detail-list">
                      <div>
                        <dt>Workspace</dt>
                        <dd>{selectedWorkspaceInvitation.workspaceName}</dd>
                      </div>
                      <div>
                        <dt>Invited email</dt>
                        <dd>{selectedWorkspaceInvitation.email || "-"}</dd>
                      </div>
                      <div>
                        <dt>Offered role</dt>
                        <dd>
                          <span className="role-badge">
                            {formatRoleLabel(selectedWorkspaceInvitation.role)}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          {formatRoleLabel(selectedWorkspaceInvitation.status)}
                        </dd>
                      </div>
                      <div>
                        <dt>Inviter</dt>
                        <dd>{selectedWorkspaceInvitation.inviter || "-"}</dd>
                      </div>
                      <div>
                        <dt>Invited</dt>
                        <dd>
                          {formatTimestamp(
                            selectedWorkspaceInvitation.invitedAt,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>
                          {formatTimestamp(
                            selectedWorkspaceInvitation.expiresAt,
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="invitation-locked-panel">
                      <strong>No workspace access yet</strong>
                      <p>
                        Templates, documents, jobs, API keys, uploads, rename,
                        deletion, and user management stay locked until this
                        invitation is accepted.
                      </p>
                    </div>

                    <div className="actions invitation-actions">
                      <button
                        type="button"
                        disabled={
                          isAcceptingWorkspaceInvitation ||
                          isDecliningWorkspaceInvitation ||
                          String(
                            selectedWorkspaceInvitation.status || "",
                          ).toLowerCase() !== "pending"
                        }
                        onClick={acceptSelectedWorkspaceInvitation}
                      >
                        {isAcceptingWorkspaceInvitation
                          ? "Accepting..."
                          : "Accept Invitation"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={
                          isAcceptingWorkspaceInvitation ||
                          isDecliningWorkspaceInvitation ||
                          String(
                            selectedWorkspaceInvitation.status || "",
                          ).toLowerCase() !== "pending"
                        }
                        onClick={declineSelectedWorkspaceInvitation}
                      >
                        {isDecliningWorkspaceInvitation
                          ? "Declining..."
                          : "Decline Invitation"}
                      </button>
                    </div>
                  </article>
                </section>
              </>
            ) : (
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
                      <p>
                        Manage workspace details and rotate API credentials.
                      </p>
                    </div>
                    <div className="row two-up workspace-name-row">
                      <label>
                        Workspace name
                        <input
                          value={workspaceName}
                          onChange={(event) =>
                            setWorkspaceName(event.target.value)
                          }
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
                        <div className="workspace-key-field">
                          <input
                            value={apiKey}
                            readOnly
                            placeholder={workspaceApiKeyPlaceholder}
                          />
                          {apiKey ? (
                            <button
                              type="button"
                              className="icon-action-button workspace-key-copy-button"
                              aria-label="Copy API key"
                              onClick={copyVisibleWorkspaceApiKey}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="workspace-inline-action"
                          disabled={busy || !canRotateWorkspaceApiKey}
                          onClick={refreshApiKey}
                        >
                          {workspaceApiKeyActionLabel}
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
                          onChange={(event) =>
                            setInviteEmail(event.target.value)
                          }
                          placeholder="teammate@example.com"
                        />
                      </label>
                      <label>
                        Invite role
                        <select
                          value={inviteRole}
                          onChange={(event) =>
                            setInviteRole(event.target.value)
                          }
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
                          disabled={busy || !hasApiAccess}
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
                              <tr
                                key={String(user.user_id || user.email || "")}
                              >
                                <td>{String(user.name || "-")}</td>
                                <td>{String(user.email || "-")}</td>
                                <td>
                                  <span className="role-badge">
                                    {formatRoleLabel(user.role)}
                                  </span>
                                </td>
                                <td>{formatJoinedAt(user.created_at)}</td>
                                <td>
                                  {canShowWorkspaceUserAction(user) &&
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

                  {canManageWorkspaceInvitations &&
                  workspaceInvitations.length > 0 ? (
                    <article className="workspace-card">
                      <div className="workspace-head">
                        <h2>Pending Invitations</h2>
                        <p>
                          Actionable workspace invitations that have not been
                          accepted.
                        </p>
                      </div>
                      {workspaceInvitations.length ? (
                        <div className="table-scroll workspace-users-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Inviter</th>
                                <th>Invited</th>
                                <th>Expires</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {workspaceInvitations.map((invitation) => (
                                <tr
                                  key={String(
                                    invitation.id || invitation.email || "",
                                  )}
                                >
                                  <td>{String(invitation.email || "-")}</td>
                                  <td>
                                    <span className="role-badge">
                                      {formatRoleLabel(invitation.role)}
                                    </span>
                                  </td>
                                  <td>{formatRoleLabel(invitation.status)}</td>
                                  <td>
                                    {String(
                                      invitation.inviter_display ||
                                        invitation.inviter_name ||
                                        invitation.inviter_email ||
                                        "-",
                                    )}
                                  </td>
                                  <td>
                                    {formatJoinedAt(invitation.created_at)}
                                  </td>
                                  <td>
                                    {formatJoinedAt(invitation.expires_at)}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="icon-action-button"
                                      aria-label={`Cancel invitation for ${String(invitation.email || "invitee")}`}
                                      disabled={busy}
                                      onClick={() =>
                                        cancelWorkspaceInvitation(invitation)
                                      }
                                    >
                                      x
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="muted">No pending invitations found.</p>
                      )}
                    </article>
                  ) : null}
                </section>
              </>
            )
          ) : null}

          {activePage === "templates" ? (
            <>
              <header className="page-header">
                <p className="eyebrow">Templates</p>
                <h2>Template Builder</h2>
                <p>
                  Build reusable extraction schemas and update existing
                  templates.
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
                        onChange={(event) =>
                          setTemplateName(event.target.value)
                        }
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
                      className="secondary"
                      disabled={isSavingTemplate || !hasApiAccess}
                      onClick={openTemplateJsonModal}
                    >
                      Export / Import
                    </button>
                    <button
                      type="button"
                      disabled={
                        isSavingTemplate ||
                        !hasApiAccess ||
                        (isEditingTemplate && !isEditedTemplateDirty)
                      }
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

        {showTemplateJsonModal ? (
          <div className="modal-backdrop" onClick={closeTemplateJsonModal}>
            <div
              className="modal-card template-json-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Export or import template JSON"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="workspace-head template-json-modal-head">
                <div>
                  <h2>Export / Import Template</h2>
                  <p>
                    Edit the raw JSON payload used by the template API. Saving
                    will validate it before updating the template.
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-action-button template-json-copy-button"
                  aria-label="Copy template JSON"
                  title={templateJsonCopied ? "Copied" : "Copy JSON"}
                  onClick={copyTemplateJson}
                >
                  <CopyIcon />
                </button>
              </div>
              <label className="template-json-label">
                Template JSON
                <textarea
                  className="template-json-textarea"
                  spellCheck="false"
                  value={templateJsonDraft}
                  onChange={(event) => {
                    setTemplateJsonDraft(event.target.value);
                    setTemplateJsonError("");
                    setTemplateJsonCopied(false);
                  }}
                />
              </label>
              {templateJsonError ? (
                <p className="form-error">{templateJsonError}</p>
              ) : templateJsonCopied ? (
                <p className="hint">Copied JSON to clipboard.</p>
              ) : null}
              <div className="actions">
                <button
                  type="button"
                  disabled={isSavingTemplate || !hasApiAccess}
                  onClick={saveTemplateJsonDraft}
                >
                  {isSavingTemplate ? "Saving..." : "Save Template JSON"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={isSavingTemplate}
                  onClick={closeTemplateJsonModal}
                >
                  Cancel
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
                <p>
                  Select a template and source files, then queue Document
                  extraction.
                </p>
              </div>
              <div className="row">
                <label>
                  Template
                  <select
                    value={uploadTemplateId}
                    onChange={(event) =>
                      setUploadTemplateId(event.target.value)
                    }
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
                  Source files
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
                    <strong>Drag and drop source files here</strong>
                    <span>
                      or click to browse Documents (PNG, JPG, WEBP, PDF)
                    </span>
                    <em>
                      {uploadFiles.length
                        ? `${uploadFiles.length} Source file${uploadFiles.length === 1 ? "" : "s"} selected`
                        : "No Source files selected"}
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
                  {isUploadingDocuments ? "Uploading..." : "Upload Documents"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function statusTone(status) {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
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

function formatTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return raw;
  }

  return new Date(timestamp).toLocaleString();
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

function getWorkspaceUserActions(userManagement, targetRole) {
  const target = String(targetRole || "")
    .trim()
    .toLowerCase();

  if (target === "owner") {
    return userManagement?.canShowOwnerActions ? ["make_admin"] : [];
  }
  if (target === "admin") {
    return userManagement?.canShowAdminActions
      ? ["remove_user", "make_owner"]
      : [];
  }
  if (target === "member" && userManagement?.canShowOwnerActions) {
    return ["remove_user", "make_admin", "make_owner"];
  }
  if (target === "member" && userManagement?.canShowMemberActions) {
    return ["remove_user"];
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

function getWorkspaceMemberActionToastAction(action) {
  if (action === "make_admin") {
    return "workspaceMember.makeAdmin";
  }
  if (action === "make_owner") {
    return "workspaceMember.transferOwnership";
  }
  return "workspaceMember.remove";
}

function defaultUploadedName(sourceMimeType) {
  if (
    typeof sourceMimeType === "string" &&
    sourceMimeType.startsWith("image/")
  ) {
    return "Uploaded Document";
  }
  if (sourceMimeType === "application/pdf") {
    return "Uploaded Document";
  }
  return "Uploaded Source file";
}

function JobStatusTracker({ job }) {
  if (!job) {
    return <p className="muted">Select an uploaded document.</p>;
  }

  const isFailure = job.status === "failed";
  const isCompleted = job.status === "completed";
  const isProcessing = LIVE_DOCUMENT_STATUSES.has(job.status);
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

function normalizeFields(fields, options = {}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Add at least one field");
  }

  const ids = new Set();
  const names = new Set();

  return fields.map((field, index) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new Error(`Field ${index + 1}: must be an object`);
    }

    const name = normalizeFieldName(field.name);
    const id = toFieldId(name);
    const description = String(field.description || "").trim();
    const dataType = normalizeDataType(field.data_type);
    const required = Boolean(field.required);
    const { baseDescription, objectSchema: descriptionObjectSchema } =
      extractObjectMetadata(description);
    const objectSchema = isObjectLikeType(dataType)
      ? normalizeObjectSchema(field.object_schema || descriptionObjectSchema)
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

    const normalizedField = {
      name,
      description: finalDescription,
      data_type: dataType,
      required,
    };

    if (options.includeFieldIds) {
      normalizedField.id = id;
    }

    if (options.includeObjectSchema && objectColumns) {
      normalizedField.object_schema = {
        mode: "table",
        columns: objectColumns.map(({ heading, data_type, description }) => ({
          heading,
          data_type,
          description,
        })),
      };
    }

    return normalizedField;
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
    key: toFieldId(String(column?.heading || "")),
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
    const heading = String(column.heading || "").trim();
    const key = toFieldId(heading);
    const description = String(column.description || "").trim();
    const dataType = String(column.data_type || "").trim();

    if (!heading) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading is required`,
      );
    }
    if (!key) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading must include letters or numbers`,
      );
    }
    if (!OBJECT_SCHEMA_DATA_TYPES.includes(dataType)) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: unsupported column type`,
      );
    }
    if (keys.has(key)) {
      throw new Error(
        `Field ${fieldIndex + 1}: duplicate object column heading "${heading}"`,
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

function validateTemplateJsonPayload(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Template JSON must be an object");
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("Template name is required");
  }

  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== "string"
  ) {
    throw new Error("Template description must be a string");
  }

  return {
    name: input.name.trim(),
    description:
      input.description === null
        ? null
        : String(input.description || "").trim(),
    fields: normalizeFields(input.fields, options),
  };
}

function serializeTemplatePayload(payload) {
  return JSON.stringify(validateTemplateJsonPayload(payload));
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

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
