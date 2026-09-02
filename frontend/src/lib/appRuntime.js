import { getActionToast, getDocumentUploadToast } from "./toastNotifications";

export function createAppRuntimeCore({
  apiBase,
  setLatestResponse,
  setLogLines,
  toast,
}) {
  const baseUrl = apiBase.replace(/\/+$/, "");

  function addLog(message) {
    const time = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${time}] ${message}`, ...prev].slice(0, 80));
  }

  function showActionToast(action, outcome, options) {
    const notification = getActionToast(action, outcome, options);
    toast[notification.severity](notification.message);
  }

  function showDocumentUploadToast(options) {
    showNotification(getDocumentUploadToast(options));
  }

  function showNotification(notification) {
    toast[notification.severity](notification.message);
  }

  function endpoint(path) {
    return `${baseUrl}${path}`;
  }

  async function request(path, options = {}) {
    const { responseType, ...fetchOptions } = options;
    const response = await fetch(endpoint(path), {
      ...fetchOptions,
      credentials: "include",
    });

    if (response.status === 304 && responseType === "conditional-json") {
      return {
        data: null,
        headers: response.headers,
        notModified: true,
        status: response.status,
      };
    }

    if (response.status === 204) {
      return null;
    }

    if (response.ok && responseType === "blob") {
      return {
        blob: await response.blob(),
        headers: response.headers,
      };
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

    if (responseType !== "resource-json") setLatestResponse(data ?? rawText);
    if (responseType === "conditional-json" || responseType === "resource-json") {
      return {
        data,
        headers: response.headers,
        notModified: false,
        status: response.status,
      };
    }
    return data;
  }

  return {
    addLog,
    endpoint,
    request,
    showActionToast,
    showDocumentUploadToast,
    showNotification,
  };
}

export function createWorkspaceRequestLayer({
  coreRequest,
  hasSession,
  workspaceId,
  onForbiddenWorkspaceAccess,
}) {
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

    try {
      return await coreRequest(path, {
        ...options,
        headers,
      });
    } catch (error) {
      if (error.status === 403 && authRequired && workspaceRequired) {
        await onForbiddenWorkspaceAccess();
      }
      throw error;
    }
  }

  return { request };
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
