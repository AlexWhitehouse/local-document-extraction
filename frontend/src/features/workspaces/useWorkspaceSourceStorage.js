import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "../../lib/describeError";

export const DEFAULT_PREFIX = "document-extraction/";

// The bucket test writes, reads back and deletes a small file. Each stage says what failed and what to check.
const TEST_STAGES = {
  write: { problem: "Couldn't write a test file to the bucket.", advice: "Check the bucket, region and access key." },
  read: { problem: "Couldn't read the test file back from the bucket.", advice: "Check that the access key can read files." },
  delete: { problem: "Couldn't delete the test file from the bucket.", advice: "Check that the access key can delete files." },
};

const UNKNOWN_STAGE = { problem: "The bucket test failed.", advice: "Check the bucket, region and access key." };

const emptyDraft = () => ({
  endpoint: "",
  region: "",
  bucket: "",
  prefix: DEFAULT_PREFIX,
  force_path_style: false,
  access_key_id: "",
  secret_access_key: "",
  session_token: "",
  confirm_unversioned_bucket: false,
});

// Access keys are never returned, so an edit starts with them blank. The confirmation is asked again on every save.
export const draftFrom = (override) =>
  override
    ? {
        ...emptyDraft(),
        endpoint: override.endpoint || "",
        region: override.region || "",
        bucket: override.bucket || "",
        prefix: override.prefix ?? DEFAULT_PREFIX,
        force_path_style: override.force_path_style === true,
      }
    : emptyDraft();

// The confirmation is asked on every save, so ticking it alone isn't an edit.
const sameDraft = (a, b) =>
  Object.keys(a).every((field) => field === "confirm_unversioned_bucket" || a[field] === b[field]);

const normalizedEndpoint = (value) => value.trim().replace(/\/+$/, "");

const normalizedPrefix = (value) => value.trim() || DEFAULT_PREFIX;

/** The saved location: endpoint, bucket, prefix and addressing style. Changing any of these moves new uploads. */
export function locationChanged(override, draft) {
  if (!override) return false;

  return (
    normalizedEndpoint(override.endpoint || "") !== normalizedEndpoint(draft.endpoint) ||
    override.bucket !== draft.bucket.trim() ||
    normalizedPrefix(override.prefix ?? "") !== normalizedPrefix(draft.prefix) ||
    override.force_path_style !== draft.force_path_style
  );
}

/**
 * Field problems for the draft, keyed by field. `forSave` adds the bucket confirmation, which
 * a test doesn't need.
 */
export function validateStorageDraft(draft, override, { forSave = true } = {}) {
  const errors = {};
  const endpoint = draft.endpoint.trim();

  if (endpoint) {
    try {
      const url = new URL(endpoint);

      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        errors.endpoint = "Enter an address like https://s3.example.com.";
    } catch {
      errors.endpoint = "Enter an address like https://s3.example.com.";
    }
  }

  if (!draft.region.trim()) errors.region = "Enter a region.";

  if (!draft.bucket.trim()) errors.bucket = "Enter a bucket name.";

  const keyId = draft.access_key_id.trim();
  const secret = draft.secret_access_key.trim();
  const keysRequired = !override || override.credential_status !== "configured";

  if (keysRequired || keyId || secret || draft.session_token.trim()) {
    if (!keyId) errors.access_key_id = "Enter the access key ID.";

    if (!secret) errors.secret_access_key = "Enter the secret access key.";
  }

  if (forSave && !draft.confirm_unversioned_bucket)
    errors.confirm_unversioned_bucket = "Confirm the bucket doesn't use versioning or Object Lock.";

  return errors;
}

function requestBody(draft, { forSave }) {
  const endpoint = draft.endpoint.trim();
  const prefix = draft.prefix.trim();
  const keyId = draft.access_key_id.trim();
  const secret = draft.secret_access_key.trim();
  const sessionToken = draft.session_token.trim();

  const body = {
    endpoint: endpoint || null,
    region: draft.region.trim(),
    bucket: draft.bucket.trim(),
    force_path_style: draft.force_path_style,
  };

  // A blank prefix takes the server default.
  if (prefix) body.prefix = prefix;

  // Both keys are left out to keep the saved ones.
  if (keyId && secret) {
    body.access_key_id = keyId;
    body.secret_access_key = secret;

    if (sessionToken) body.session_token = sessionToken;
  }

  if (forSave) body.confirm_unversioned_bucket = draft.confirm_unversioned_bucket === true;

  return body;
}

const failedStage = (error) =>
  error?.code === "source_storage_test_failed" ? (TEST_STAGES[error.details?.stage] ?? UNKNOWN_STAGE) : null;

/** Toast text for a failed save: what failed, then why when that is known. */
export function sourceStorageSaveFailure(error) {
  const reason = failedStage(error)?.problem || describeError(error, "");

  return reason ? `Couldn't save storage settings. ${reason}` : "Couldn't save storage settings.";
}

/** Toast text for a failed test: the stage that failed and what to check. */
export function sourceStorageTestFailure(error) {
  const stage = failedStage(error);

  if (stage) return `${stage.problem} ${stage.advice}`;
  const reason = describeError(error, "");

  return `Test failed. ${reason || UNKNOWN_STAGE.advice}`;
}

function storageETag(response) {
  const override = response?.data?.override;

  // Proxies can remove or weaken ETag headers; the revision names the same version.
  if (override && Number.isSafeInteger(override.revision) && override.revision > 0) {
    return `"source-storage-${override.revision}"`;
  }

  return response?.headers?.get("etag") ?? null;
}

const initialState = (scope) => ({
  scope,
  record: null,
  etag: null,
  draft: emptyDraft(),
  pathStyleTouched: false,
  loading: false,
  saving: false,
  testing: false,
  error: "",
  testResult: null,
});

/**
 * Where this Workspace keeps new originals: default storage, or its own S3-compatible bucket.
 * Owners and admins only; members never load it.
 */
export function useWorkspaceSourceStorage({
  coreRequest,
  workspaceId,
  sessionUserId,
  role,
  enabled,
  showActionToast,
  onChanged,
}) {
  const canManage = role === "owner" || role === "admin";
  const scope = enabled && canManage && workspaceId && sessionUserId ? `${sessionUserId}:${workspaceId}:${role}` : "";
  const [state, setState] = useState(() => initialState(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const current = useRef(state);
  current.current = state;
  const operation = useRef(0);
  const draftVersion = useRef(0);
  const notify = useRef(showActionToast);
  notify.current = showActionToast;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const path = `/workspaces/${encodeURIComponent(workspaceId)}/source-storage`;

  const load = useCallback(async () => {
    if (!scope) return;
    const token = ++operation.current;
    draftVersion.current += 1;
    setState((previous) => ({
      ...initialState(scope),
      loading: true,
      record: previous.scope === scope ? previous.record : null,
    }));

    try {
      const response = await coreRequest(path, { method: "GET", cache: "no-store", responseType: "resource-json" });

      if (activeScope.current !== scope || token !== operation.current) return;
      const record = response.data;
      setState({ ...initialState(scope), record, etag: storageETag(response), draft: draftFrom(record?.override) });
    } catch {
      if (activeScope.current === scope && token === operation.current)
        setState({ ...initialState(scope), error: "Couldn't load storage settings." });
    }
  }, [coreRequest, path, scope]);

  useEffect(() => {
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

      // Most S3-compatible services need path-style addressing; AWS S3 doesn't.
      if (field === "endpoint" && !previous.pathStyleTouched) draft.force_path_style = Boolean(value.trim());

      return {
        ...previous,
        draft,
        pathStyleTouched: previous.pathStyleTouched || field === "force_path_style",
        testing: false,
        testResult: null,
      };
    });
  };

  const discard = () => {
    draftVersion.current += 1;
    setState((previous) => ({
      ...previous,
      draft: draftFrom(previous.record?.override),
      pathStyleTouched: false,
      testing: false,
      testResult: null,
    }));
  };

  const apply = (response) => {
    const record = response?.data;
    draftVersion.current += 1;
    setState({ ...initialState(scope), record, etag: storageETag(response), draft: draftFrom(record?.override) });
  };

  // A stale version or a changed operator setting reloads the latest settings.
  const reloadsAfter = (error) => error?.status === 412 || error?.code === "source_storage_overrides_disabled";

  // Saved keys that can't be read must be entered again, so the form starts requiring them.
  const markKeysUnavailable = (error) => {
    if (error?.code !== "source_storage_credentials_unavailable") return;
    setState((previous) =>
      previous.record?.override
        ? {
            ...previous,
            record: {
              ...previous.record,
              override: { ...previous.record.override, credential_status: "unavailable" },
            },
          }
        : previous,
    );
  };

  /**
   * Saves the draft. Resolves "saved", "reloaded" (settings changed elsewhere; the latest are now shown) or
   * "failed". Field problems are the caller's to check first.
   */
  async function save() {
    const snapshot = current.current;

    if (!scope || snapshot.scope !== scope || snapshot.saving || !snapshot.record) return "failed";
    const override = snapshot.record.override;
    const token = ++operation.current;
    draftVersion.current += 1;
    setState((previous) => ({ ...previous, saving: true, testing: false, testResult: null }));

    try {
      const response = await coreRequest(path, {
        method: "PUT",
        cache: "no-store",
        responseType: "resource-json",
        headers: {
          "content-type": "application/json",
          ...(override ? { "if-match": snapshot.etag } : { "if-none-match": "*" }),
        },
        body: JSON.stringify(requestBody(snapshot.draft, { forSave: true })),
      });

      if (activeScope.current !== scope || token !== operation.current) return "failed";
      apply(response);
      notify.current?.("workspace.sourceStorage.save", "success");
      changed.current?.();

      return "saved";
    } catch (error) {
      if (activeScope.current !== scope || token !== operation.current) return "failed";
      notify.current?.("workspace.sourceStorage.save", "failure", { message: sourceStorageSaveFailure(error) });

      if (reloadsAfter(error)) {
        void load();

        return "reloaded";
      }

      setState((previous) => ({ ...previous, saving: false }));
      markKeysUnavailable(error);

      return "failed";
    }
  }

  // Runs inside a confirmation dialog, so failures throw for the dialog to show.
  async function remove() {
    const snapshot = current.current;

    if (!scope || snapshot.scope !== scope || snapshot.saving || !snapshot.record?.override)
      throw new Error("Storage settings aren't ready.");
    const token = ++operation.current;
    setState((previous) => ({ ...previous, saving: true, testing: false, testResult: null }));

    try {
      await coreRequest(path, {
        method: "DELETE",
        cache: "no-store",
        headers: { "if-match": snapshot.etag },
      });

      if (activeScope.current === scope && token === operation.current) {
        notify.current?.("workspace.sourceStorage.remove", "success");
        changed.current?.();
        void load();
      }
    } catch (error) {
      if (activeScope.current === scope && token === operation.current) {
        if (reloadsAfter(error)) void load();
        else setState((previous) => ({ ...previous, saving: false }));
      }

      throw error;
    }
  }

  /** Tests the draft, or the saved settings with `saved`. The outcome is a toast. */
  async function testConnection({ saved = false } = {}) {
    const snapshot = current.current;

    if (!scope || snapshot.scope !== scope || snapshot.saving || snapshot.testing || !snapshot.record) return;
    const draft = saved ? draftFrom(snapshot.record.override) : snapshot.draft;
    const version = ++draftVersion.current;
    setState((previous) => ({ ...previous, testing: true, testResult: null }));

    try {
      await coreRequest(`${path}/test`, {
        method: "POST",
        cache: "no-store",
        responseType: "resource-json",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(draft, { forSave: false })),
      });

      if (activeScope.current === scope && draftVersion.current === version) {
        setState((previous) => ({ ...previous, testing: false, testResult: { passed: true } }));
        notify.current?.("workspace.sourceStorage.test", "success");
      }
    } catch (error) {
      if (activeScope.current === scope && draftVersion.current === version) {
        setState((previous) => ({ ...previous, testing: false, testResult: { passed: false } }));
        notify.current?.("workspace.sourceStorage.test", "failure", { message: sourceStorageTestFailure(error) });

        if (error?.code === "source_storage_overrides_disabled") void load();
        else markKeysUnavailable(error);
      }
    }
  }

  const visible = state.scope === scope ? state : initialState(scope);

  return {
    ...visible,
    canManage,
    dirty: !sameDraft(visible.draft, draftFrom(visible.record?.override)),
    update,
    discard,
    save,
    remove,
    testConnection,
    reload: load,
  };
}
