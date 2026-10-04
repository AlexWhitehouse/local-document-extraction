import { useCallback, useEffect, useRef, useState } from "react";

const emptyDraft = () => ({
  gateway_url: "",
  model_name: "",
  credential: "",
  sequential_calls: false,
  supports_pdf_input: false,
  supports_structured_output: false,
  // Task roles inherit the extraction model unless the draft names their own.
  assistant_mode: "same",
  assistant_model_name: "",
  assistant_supports_pdf_input: false,
  assistant_supports_structured_output: false,
  classification_mode: "same",
  classification_model_name: "",
  classification_supports_pdf_input: false,
  classification_supports_structured_output: false,
});

const invalidDraftMessage = "Enter a valid HTTP(S) gateway URL, model names, and a new credential when required.";

const draftFrom = (record) => {
  if (!record?.configured) return emptyDraft();

  const roleDraft = (role) => {
    const model = record[`${role}_model`];

    return {
      [`${role}_mode`]: model ? "custom" : "same",
      [`${role}_model_name`]: model?.model_name || "",
      [`${role}_supports_pdf_input`]: Boolean((model ?? record).supports_pdf_input),
      [`${role}_supports_structured_output`]: Boolean((model ?? record).supports_structured_output),
    };
  };

  return {
    ...emptyDraft(),
    gateway_url: record.gateway_url || "",
    model_name: record.model_name || "",
    sequential_calls: Boolean(record.sequential_calls),
    supports_pdf_input: Boolean(record.supports_pdf_input),
    supports_structured_output: Boolean(record.supports_structured_output),
    ...roleDraft("assistant"),
    ...roleDraft("classification"),
  };
};

const initialState = (scope) => ({
  scope,
  record: null,
  etag: null,
  draft: emptyDraft(),
  loading: false,
  saving: false,
  testing: false,
  dirty: false,
  conflict: false,
  error: "",
  feedback: "",
  testResult: null,
});

function configurationETag(response) {
  const record = response?.data;

  // Proxies can remove or weaken ETag headers. The body revision identifies the
  // same origin version, so conditional writes and revalidation remain reliable.
  if (record?.configured && Number.isSafeInteger(record.revision) && record.revision > 0) {
    return `"workspace-model-${record.revision}"`;
  }

  return response?.headers?.get("etag") ?? null;
}

export function useWorkspaceModelConfiguration({
  coreRequest,
  workspaceId,
  sessionUserId,
  role,
  enabled,
  showActionToast,
}) {
  const scope = enabled && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}:${role}` : "";
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState(() => initialState(scope));
  const activeScope = useRef(scope);
  const current = useRef(state);
  const operation = useRef(0);
  const draftVersion = useRef(0);
  const notify = useRef(showActionToast);
  notify.current = showActionToast;
  const mutationPending = useRef(false);
  const pendingInvalidation = useRef(false);
  activeScope.current = scope;
  current.current = state;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/model-configuration`;

  const load = useCallback(
    async (external = false) => {
      if (!scope) return;

      if (external && mutationPending.current) {
        pendingInvalidation.current = true;

        return;
      }

      const token = ++operation.current;

      if (!external) {
        draftVersion.current += 1;
        setState((previous) => ({
          ...initialState(scope),
          loading: true,
          record: previous.scope === scope ? previous.record : null,
        }));
      }

      try {
        const response = await coreRequest(path, { method: "GET", cache: "no-store", responseType: "resource-json" });

        if (activeScope.current !== scope || token !== operation.current) return;
        const record = response.data;
        const etag = configurationETag(response);
        setState((previous) => {
          if (
            external &&
            previous.etag === etag &&
            previous.record?.configured === record.configured &&
            previous.record?.credential_status === record.credential_status
          )
            return previous;
          draftVersion.current += 1;

          if (external && previous.dirty)
            return {
              ...previous,
              conflict: true,
              testResult: null,
              testing: false,
              error: "Configuration changed in another session. Reload before saving; this discards your draft.",
            };

          return { ...initialState(scope), record, etag, draft: draftFrom(record) };
        });
      } catch {
        if (activeScope.current === scope && token === operation.current) {
          draftVersion.current += 1;
          setState((previous) => ({
            ...previous,
            scope,
            loading: false,
            testing: false,
            testResult: null,
            record: null,
            error: "Model configuration could not be loaded. Try again.",
          }));
        }
      }
    },
    [coreRequest, path, scope],
  );

  useEffect(() => {
    mutationPending.current = false;
    pendingInvalidation.current = false;
    setState(initialState(scope));
    void load();

    return () => {
      operation.current += 1;
      draftVersion.current += 1;
    };
  }, [load, scope]);

  const update = (field, value) => {
    draftVersion.current += 1;
    setState((previous) => {
      const draft = { ...previous.draft, [field]: value };

      // A newly selected task role starts with the extraction capabilities.
      for (const role of ["assistant", "classification"]) {
        if (field === `${role}_mode` && value === "custom" && previous.draft[field] !== "custom") {
          draft[`${role}_supports_pdf_input`] = previous.draft.supports_pdf_input;
          draft[`${role}_supports_structured_output`] = previous.draft.supports_structured_output;
        }
      }

      return {
        ...previous,
        draft,
        dirty: true,
        testResult: null,
        testing: false,
        feedback: "",
        error: previous.conflict ? previous.error : "",
      };
    });
  };

  const discard = () => {
    draftVersion.current += 1;
    setState((previous) => ({
      ...previous,
      draft: draftFrom(previous.record),
      dirty: false,
      testing: false,
      testResult: null,
      feedback: "",
      error: previous.conflict ? previous.error : "",
    }));
  };

  const apply = (response) => {
    const record = response?.data ?? { configured: false };
    draftVersion.current += 1;
    setState({
      ...initialState(scope),
      record,
      etag: configurationETag(response),
      draft: draftFrom(record),
      feedback: record.configured ? "Model gateway saved." : "Model gateway cleared.",
    });
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
      const options = {
        method: clear ? "DELETE" : "PUT",
        cache: "no-store",
        responseType: "resource-json",
        headers: {
          "content-type": "application/json",
          ...(snapshot.record?.configured ? { "if-match": snapshot.etag } : { "if-none-match": "*" }),
        },
      };

      if (!clear) options.body = JSON.stringify(requestDraft(snapshot.draft));
      const response = await coreRequest(path, options);

      if (activeScope.current === scope && token === operation.current) {
        apply(response);
        notify.current?.(clear ? "workspace.modelGateway.clear" : "workspace.modelGateway.save", "success");

        return true;
      }

      return false;
    } catch (error) {
      if (activeScope.current === scope && token === operation.current) {
        // A conflict stays inline beside its Reload action; other failures are a toast.
        setState((previous) => ({
          ...previous,
          saving: false,
          conflict: error.status === 412,
          error:
            error.status === 412
              ? "Configuration changed in another session. Reload before saving; this discards your draft."
              : "",
        }));

        if (error.status !== 412)
          notify.current?.(clear ? "workspace.modelGateway.clear" : "workspace.modelGateway.save", "failure");
      }

      return false;
    } finally {
      if (activeScope.current === scope && token === operation.current) {
        mutationPending.current = false;

        if (pendingInvalidation.current) {
          pendingInvalidation.current = false;
          void load(true);
        }
      }
    }
  }

  async function testConnection() {
    const snapshot = current.current;

    if (!scope || snapshot.scope !== scope || !canManage || snapshot.saving || snapshot.testing || snapshot.conflict)
      return;

    if (!validDraft(snapshot)) {
      setState((previous) => ({ ...previous, error: invalidDraftMessage }));

      return;
    }

    const version = ++draftVersion.current;
    setState((previous) => ({ ...previous, testing: true, testResult: null, error: "", feedback: "" }));

    try {
      const headers = { "content-type": "application/json" };

      if (!snapshot.draft.credential.trim() && snapshot.etag) headers["if-match"] = snapshot.etag;

      const response = await coreRequest(`${path}/test`, {
        method: "POST",
        cache: "no-store",
        responseType: "resource-json",
        headers,
        body: JSON.stringify(requestDraft(snapshot.draft)),
      });

      const tested = response?.data?.tested_models?.length ?? 1;

      const passedMessage =
        tested > 1
          ? `Connection test passed for ${tested === 2 ? "both" : "all"} models in this draft. Capabilities are not tested.`
          : "Connection test passed for this draft. Capabilities are not tested.";

      if (activeScope.current === scope && draftVersion.current === version) {
        setState((previous) => ({ ...previous, testing: false, testResult: { passed: true, message: passedMessage } }));
        notify.current?.("workspace.modelGateway.test", "success", { message: passedMessage });
      }
    } catch (error) {
      const failedModel =
        error.details?.model_role === "assistant"
          ? "the Template assistant model"
          : error.details?.model_role === "classification"
            ? "the Document classification & splitting model"
            : "the gateway, model,";

      const message =
        error.status === 412
          ? "Configuration changed. Reload before testing the saved credential."
          : `Connection test failed. Check ${failedModel} and credential. You can still save this draft.`;

      if (activeScope.current === scope && draftVersion.current === version) {
        setState((previous) => ({
          ...previous,
          testing: false,
          conflict: error.status === 412,
          testResult: { passed: false, message },
        }));
        notify.current?.("workspace.modelGateway.test", "failure", { message });
      }
    }
  }

  const visible = state.scope === scope ? state : initialState(scope);

  return {
    ...visible,
    canManage,
    ready: Boolean(
      !visible.loading &&
      !visible.conflict &&
      visible.record?.configured &&
      (!canManage || visible.record.credential_status === "configured"),
    ),
    update,
    discard,
    save: () => mutate(),
    clear: () => mutate(true),
    testConnection,
    reload: () => load(),
    invalidate: () => load(true),
  };
}

function requestDraft(draft) {
  const taskModel = (role) =>
    draft[`${role}_mode`] === "custom"
      ? {
          model_name: draft[`${role}_model_name`].trim(),
          supports_pdf_input: draft[`${role}_supports_pdf_input`],
          supports_structured_output: draft[`${role}_supports_structured_output`],
        }
      : null;

  const request = {
    gateway_url: draft.gateway_url.trim(),
    model_name: draft.model_name.trim(),
    sequential_calls: draft.sequential_calls,
    supports_pdf_input: draft.supports_pdf_input,
    supports_structured_output: draft.supports_structured_output,
    assistant_model: taskModel("assistant"),
    classification_model: taskModel("classification"),
  };

  if (draft.credential.trim()) request.credential = draft.credential.trim();

  return request;
}

function validDraft(state) {
  const { gateway_url, model_name, credential } = state.draft;

  for (const role of ["assistant", "classification"]) {
    const modelName = state.draft[`${role}_model_name`].trim();

    if (state.draft[`${role}_mode`] === "custom" && (!modelName || modelName.length > 256)) return false;
  }

  try {
    const url = new URL(gateway_url.trim());

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      gateway_url.includes("?") ||
      gateway_url.includes("#") ||
      gateway_url.trim().length > 2048
    )
      return false;
  } catch {
    return false;
  }

  return Boolean(
    model_name.trim() &&
    model_name.trim().length <= 256 &&
    credential.trim().length <= 8192 &&
    (credential.trim() || state.record?.credential_status === "configured"),
  );
}
