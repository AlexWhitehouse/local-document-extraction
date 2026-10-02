import { useCallback, useEffect, useRef, useState } from "react";

const emptyDraft = () => ({
  gateway_url: "", model_name: "", credential: "", sequential_calls: false, supports_pdf_input: false, supports_structured_output: false,
  // The Template assistant inherits the extraction model unless the draft names its own.
  assistant_mode: "same", assistant_model_name: "", assistant_supports_pdf_input: false, assistant_supports_structured_output: false,
});
const invalidDraftMessage = "Enter a valid HTTP(S) gateway URL, model names, and a new credential when required.";
const draftFrom = (record) => {
  if (!record?.configured) return emptyDraft();
  const assistant = record.assistant_model;
  return {
    ...emptyDraft(),
    gateway_url: record.gateway_url || "", model_name: record.model_name || "", sequential_calls: Boolean(record.sequential_calls),
    supports_pdf_input: Boolean(record.supports_pdf_input), supports_structured_output: Boolean(record.supports_structured_output),
    ...(assistant
      ? { assistant_mode: "custom", assistant_model_name: assistant.model_name || "", assistant_supports_pdf_input: Boolean(assistant.supports_pdf_input), assistant_supports_structured_output: Boolean(assistant.supports_structured_output) }
      : { assistant_supports_pdf_input: Boolean(record.supports_pdf_input), assistant_supports_structured_output: Boolean(record.supports_structured_output) }),
  };
};
const initialState = (scope) => ({ scope, record: null, etag: null, draft: emptyDraft(), loading: false, saving: false, testing: false, dirty: false, conflict: false, error: "", feedback: "", testResult: null });

function configurationETag(response) {
  const record = response?.data;
  // Proxies can remove or weaken ETag headers. The body revision identifies the
  // same origin version, so conditional writes and revalidation remain reliable.
  if (record?.configured && Number.isSafeInteger(record.revision) && record.revision > 0) {
    return `"workspace-model-${record.revision}"`;
  }
  return response?.headers?.get("etag") ?? null;
}

export function useWorkspaceModelConfiguration({ coreRequest, workspaceId, sessionUserId, role, enabled }) {
  const scope = enabled && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}:${role}` : "";
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState(() => initialState(scope));
  const activeScope = useRef(scope);
  const current = useRef(state);
  const operation = useRef(0);
  const draftVersion = useRef(0);
  const mutationPending = useRef(false);
  const pendingInvalidation = useRef(false);
  activeScope.current = scope;
  current.current = state;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/model-configuration`;
  const load = useCallback(async (external = false) => {
    if (!scope) return;
    if (external && mutationPending.current) { pendingInvalidation.current = true; return; }
    const token = ++operation.current;
    if (!external) {
      draftVersion.current += 1;
      setState((previous) => ({ ...initialState(scope), loading: true, record: previous.scope === scope ? previous.record : null }));
    }
    try {
      const response = await coreRequest(path, { method: "GET", cache: "no-store", responseType: "resource-json" });
      if (activeScope.current !== scope || token !== operation.current) return;
      const record = response.data;
      const etag = configurationETag(response);
      setState((previous) => {
        if (external && previous.etag === etag && previous.record?.configured === record.configured && previous.record?.credential_status === record.credential_status) return previous;
        draftVersion.current += 1;
        if (external && previous.dirty) return { ...previous, conflict: true, testResult: null, testing: false, error: "Configuration changed in another session. Reload before saving; this discards your draft." };
        return { ...initialState(scope), record, etag, draft: draftFrom(record) };
      });
    } catch {
      if (activeScope.current === scope && token === operation.current) {
        draftVersion.current += 1;
        setState((previous) => ({ ...previous, scope, loading: false, testing: false, testResult: null, record: null, error: "Model configuration could not be loaded. Try again." }));
      }
    }
  }, [coreRequest, path, scope]);
  useEffect(() => {
    mutationPending.current = false;
    pendingInvalidation.current = false;
    setState(initialState(scope));
    void load();
    return () => { operation.current += 1; draftVersion.current += 1; };
  }, [load, scope]);

  const update = (field, value) => {
    draftVersion.current += 1;
    setState((previous) => {
      const draft = { ...previous.draft, [field]: value };
      // Switching to a different assistant model starts from the extraction model's capabilities.
      if (field === "assistant_mode" && value === "custom" && previous.draft.assistant_mode !== "custom") {
        draft.assistant_supports_pdf_input = previous.draft.supports_pdf_input;
        draft.assistant_supports_structured_output = previous.draft.supports_structured_output;
      }
      return { ...previous, draft, dirty: true, testResult: null, testing: false, feedback: "", error: previous.conflict ? previous.error : "" };
    });
  };
  const discard = () => {
    draftVersion.current += 1;
    setState((previous) => ({ ...previous, draft: draftFrom(previous.record), dirty: false, testing: false, testResult: null, feedback: "", error: previous.conflict ? previous.error : "" }));
  };
  const apply = (response) => {
    const record = response?.data ?? { configured: false };
    draftVersion.current += 1;
    setState({ ...initialState(scope), record, etag: configurationETag(response), draft: draftFrom(record), feedback: record.configured ? "Model gateway saved." : "Model gateway cleared." });
  };
  async function mutate(clear = false) {
    const snapshot = current.current;
    if (!scope || snapshot.scope !== scope || !canManage || snapshot.saving || snapshot.conflict) return false;
    if (!clear && !validDraft(snapshot)) {
      setState((previous) => ({ ...previous, error: invalidDraftMessage }));
      return false;
    }
    const token = ++operation.current;
    mutationPending.current = true;
    draftVersion.current += 1;
    setState((previous) => ({ ...previous, saving: true, error: "", feedback: "", testing: false, testResult: null }));
    try {
      const response = await coreRequest(path, {
        method: clear ? "DELETE" : "PUT", cache: "no-store", responseType: "resource-json",
        headers: { "content-type": "application/json", ...(snapshot.record?.configured ? { "if-match": snapshot.etag } : { "if-none-match": "*" }) },
        ...(clear ? {} : { body: JSON.stringify(requestDraft(snapshot.draft)) }),
      });
      if (activeScope.current === scope && token === operation.current) { apply(response); return true; }
      return false;
    } catch (error) {
      if (activeScope.current === scope && token === operation.current) setState((previous) => ({ ...previous, saving: false, conflict: error.status === 412, error: error.status === 412 ? "Configuration changed in another session. Reload before saving; this discards your draft." : "Configuration could not be saved. Replace an unavailable credential or try again." }));
      return false;
    } finally {
      if (activeScope.current === scope && token === operation.current) {
        mutationPending.current = false;
        if (pendingInvalidation.current) { pendingInvalidation.current = false; void load(true); }
      }
    }
  }
  async function testConnection() {
    const snapshot = current.current;
    if (!scope || snapshot.scope !== scope || !canManage || snapshot.saving || snapshot.testing || snapshot.conflict) return;
    if (!validDraft(snapshot)) {
      setState((previous) => ({ ...previous, error: invalidDraftMessage }));
      return;
    }
    const version = ++draftVersion.current;
    setState((previous) => ({ ...previous, testing: true, testResult: null, error: "", feedback: "" }));
    try {
      const response = await coreRequest(`${path}/test`, {
        method: "POST", cache: "no-store", responseType: "resource-json",
        headers: { "content-type": "application/json", ...(!snapshot.draft.credential.trim() && snapshot.etag ? { "if-match": snapshot.etag } : {}) },
        body: JSON.stringify(requestDraft(snapshot.draft)),
      });
      const tested = response?.data?.tested_models?.length ?? 1;
      const passedMessage = tested > 1 ? "Connection test passed for both models in this draft. Capabilities are not tested." : "Connection test passed for this draft. Capabilities are not tested.";
      if (activeScope.current === scope && draftVersion.current === version) setState((previous) => ({ ...previous, testing: false, testResult: { passed: true, message: passedMessage } }));
    } catch (error) {
      const failedModel = error.details?.model_role === "assistant" ? "the Template assistant model" : "the gateway, model,";
      if (activeScope.current === scope && draftVersion.current === version) setState((previous) => ({ ...previous, testing: false, conflict: error.status === 412, testResult: { passed: false, message: error.status === 412 ? "Configuration changed. Reload before testing the saved credential." : `Connection test failed. Check ${failedModel} and credential. You can still save this draft.` } }));
    }
  }
  const visible = state.scope === scope ? state : initialState(scope);
  return {
    ...visible, canManage,
    ready: Boolean(!visible.loading && !visible.conflict && visible.record?.configured && (!canManage || visible.record.credential_status === "configured")),
    update, discard, save: () => mutate(), clear: () => mutate(true), testConnection,
    reload: () => load(), invalidate: () => load(true),
  };
}

function requestDraft(draft) {
  const { credential, assistant_mode, assistant_model_name, assistant_supports_pdf_input, assistant_supports_structured_output, ...fields } = draft;
  return {
    ...fields, gateway_url: fields.gateway_url.trim(), model_name: fields.model_name.trim(), ...(credential.trim() ? { credential: credential.trim() } : {}),
    assistant_model: assistant_mode === "custom"
      ? { model_name: assistant_model_name.trim(), supports_pdf_input: assistant_supports_pdf_input, supports_structured_output: assistant_supports_structured_output }
      : null,
  };
}

function validDraft(state) {
  const { gateway_url, model_name, credential, assistant_mode, assistant_model_name } = state.draft;
  if (assistant_mode === "custom" && (!assistant_model_name.trim() || assistant_model_name.trim().length > 256)) return false;
  try {
    const url = new URL(gateway_url.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || gateway_url.includes("?") || gateway_url.includes("#") || gateway_url.trim().length > 2048) return false;
  } catch { return false; }
  return Boolean(model_name.trim() && model_name.trim().length <= 256 && credential.trim().length <= 8192 && (credential.trim() || state.record?.credential_status === "configured"));
}
