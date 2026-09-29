import { getActionToast, getDocumentUploadToast } from "./toastNotifications";

export function createAppRuntimeCore({ apiBase, toast }) {
  const baseUrl = apiBase.replace(/\/+$/, "");

  function showNotification(notification) {
    toast[notification.severity](notification.message);
  }

  async function request(path, options = {}) {
    const { responseType, ...fetchOptions } = options;
    const response = await fetch(`${baseUrl}${path}`, {
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
    request,
    showActionToast: (action, outcome, options) =>
      showNotification(getActionToast(action, outcome, options)),
    showDocumentUploadToast: (options) => showNotification(getDocumentUploadToast(options)),
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
    const { recoverForbiddenAccess = true, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers || {});

    if (authRequired && !hasSession) {
      throw new Error("Sign in to continue");
    }
    if (authRequired && workspaceRequired) {
      if (!workspaceId.trim()) {
        throw new Error("Workspace ID is required");
      }
      headers.set("x-workspace-id", workspaceId.trim());
    }

    try {
      return await coreRequest(path, {
        ...requestOptions,
        headers,
      });
    } catch (error) {
      if (error.status === 403 && recoverForbiddenAccess && authRequired && workspaceRequired) {
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
