import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSourceStorage } from "./WorkspaceSourceStorage.jsx";
import {
  sourceStorageSaveFailure,
  sourceStorageTestFailure,
  useWorkspaceSourceStorage,
} from "./useWorkspaceSourceStorage.js";
import { getActionToast } from "../../lib/toastNotifications.js";
import { describeError } from "../../lib/describeError.js";
import { formatSize, MOVE_POLL_MS } from "./useWorkspaceSourceStorageMove.js";

const savedOverride = {
  endpoint: "https://s3.example.com",
  region: "eu-west-2",
  bucket: "customer-documents",
  prefix: "document-extraction/",
  force_path_style: true,
  access_key_id_hint: "…WXYZ",
  credential_status: "configured",
  revision: 3,
  updated_at: "2026-10-15T10:00:00.000Z",
};

const storageRecord = (override = null, extra = {}) => ({
  workspace_id: "workspace_a",
  overrides_enabled: true,
  installation_provider: "local",
  override,
  previous_locations_pending: 0,
  ...extra,
});

const response = (data) => ({
  data,
  headers: new Headers(data?.override ? { etag: `"source-storage-${data.override.revision}"` } : {}),
});

const props = { workspaceId: "workspace_a", sessionUserId: "user_a", role: "owner", enabled: true };

const apiError = (status, code, details = {}) =>
  Object.assign(new Error(code), { status, code, details: { code, ...details } });

const installationLocation = {
  id: "installation",
  kind: "installation_bucket",
  is_target: true,
  retired: false,
  bucket: "installation-documents",
  prefix: "document-extraction/",
  endpoint: null,
  originals: 0,
  bytes: 0,
  unknown_size: 0,
};

// Every original is already in the current location, so there is nothing to report.
const moveSummary = (extra = {}) => ({
  workspace_id: "workspace_a",
  target: { id: "installation", kind: "installation_bucket", bucket: "installation-documents", prefix: "document-extraction/", endpoint: null },
  unavailable_reason: null,
  locations: [installationLocation],
  movable: 0,
  move: null,
  ...extra,
});

const kindOf = (path, options) =>
  path.endsWith("/test") ? "TEST" : path.endsWith("/move") ? `MOVE_${options.method}` : options.method;

// A server double for the source-storage routes. `fail(kind, error)` makes the next matching request throw.
// `moves` answers the move routes in turn; the last answer repeats.
function storageApi(initial, ...moves) {
  let saved = initial;
  const failures = [];
  const moveAnswers = moves.length ? moves : [moveSummary()];

  const request = vi.fn(async (path, options) => {
    const kind = kindOf(path, options);
    const failure = failures.findIndex((entry) => entry.kind === kind);

    if (failure >= 0) throw failures.splice(failure, 1)[0].error;

    if (kind.startsWith("MOVE_")) return { data: moveAnswers.length > 1 ? moveAnswers.shift() : moveAnswers[0] };

    if (kind === "GET") return response(saved);

    if (kind === "TEST") return response({ ok: true });

    if (kind === "DELETE") {
      saved = { ...saved, override: null };

      return null;
    }

    const { access_key_id, secret_access_key: _secret, session_token: _token, confirm_unversioned_bucket: _confirmed, ...fields } =
      JSON.parse(options.body);

    saved = {
      ...saved,
      override: {
        prefix: "document-extraction/",
        ...fields,
        access_key_id_hint: access_key_id ? `…${access_key_id.slice(-4)}` : saved.override.access_key_id_hint,
        credential_status: "configured",
        revision: (saved.override?.revision ?? 0) + 1,
        updated_at: "2026-10-15T11:00:00.000Z",
      },
    };

    return response(saved);
  });

  return {
    request,
    fail: (kind, error) => failures.push({ kind, error }),
    replace: (next) => {
      saved = next;
    },
    calls: (kind) => request.mock.calls.filter(([path, options]) => kindOf(path, options) === kind),
  };
}

function renderPanel(api, overrides = {}) {
  const showActionToast = vi.fn();
  const onChanged = vi.fn();

  function Panel() {
    const controller = useWorkspaceSourceStorage({
      ...props,
      coreRequest: api.request,
      showActionToast,
      onChanged,
      ...overrides,
    });

    return <WorkspaceSourceStorage controller={controller} />;
  }

  const view = render(<Panel />);

  return { ...view, showActionToast, onChanged };
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const lastBody = (api, kind) => JSON.parse(api.calls(kind).at(-1)[1].body);

describe("Workspace original document storage", () => {
  it("summarises a saved Workspace bucket without exposing its keys", async () => {
    const api = storageApi(storageRecord(savedOverride, { previous_locations_pending: 2 }));
    renderPanel(api);

    expect(await screen.findByText("Workspace bucket")).toBeTruthy();
    expect(screen.getByText("New originals are saved in this workspace's own bucket.")).toBeTruthy();
    expect(screen.getByText("https://s3.example.com")).toBeTruthy();
    expect(screen.getByText("eu-west-2")).toBeTruthy();
    expect(screen.getByText("customer-documents")).toBeTruthy();
    expect(screen.getByText("document-extraction/")).toBeTruthy();
    expect(screen.getByText("Path style")).toBeTruthy();
    expect(screen.getByText("…WXYZ")).toBeTruthy();
    expect(screen.getByText("Originals saved in earlier locations stay there until they're moved or deleted.")).toBeTruthy();
    expect(screen.queryByLabelText("Bucket")).toBeNull();
    expect(screen.getByRole("button", { name: "Use default storage" })).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith(
      "/workspaces/workspace_a/source-storage",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("names AWS S3 when no endpoint is saved and says when no default storage exists", async () => {
    const api = storageApi(
      storageRecord({ ...savedOverride, endpoint: null, force_path_style: false }, { installation_provider: "none" }),
    );

    renderPanel(api);

    expect(await screen.findByText("AWS S3")).toBeTruthy();
    expect(screen.getByText("Virtual-hosted style")).toBeTruthy();
    expect(screen.queryByText(/earlier locations/)).toBeNull();
    expect(screen.getByRole("button", { name: "Remove bucket" })).toBeTruthy();
  });

  it("shows default storage before a bucket is added", async () => {
    renderPanel(storageApi(storageRecord()));

    expect(await screen.findByText("Default storage")).toBeTruthy();
    expect(screen.getByText(/New originals use default storage/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add bucket…" })).toBeTruthy();
  });

  it("creates a bucket with If-None-Match only after the versioning confirmation", async () => {
    const api = storageApi(storageRecord());
    const { showActionToast, onChanged } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add bucket…" }));
    expect(screen.getByLabelText("Prefix").value).toBe("document-extraction/");
    expect(screen.getByLabelText("Path-style addressing").checked).toBe(false);
    type("Endpoint", "https://s3.example.com");
    // Entering an endpoint switches on path-style addressing.
    expect(screen.getByLabelText("Path-style addressing").checked).toBe(true);
    type("Region", "eu-west-2");
    type("Bucket", "customer-documents");
    type("Access key ID", "AKIAEXAMPLEWXYZ");
    type("Secret access key", "secret-value");
    expect(screen.getByLabelText("Secret access key").type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));
    const confirmation = screen.getByLabelText("This bucket doesn't use versioning or Object Lock");
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Confirm the bucket doesn't use versioning or Object Lock.")).toBeTruthy();
    expect(api.calls("PUT")).toHaveLength(0);

    fireEvent.click(confirmation);
    expect(screen.queryByText("Confirm the bucket doesn't use versioning or Object Lock.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "success"));
    const [, options] = api.calls("PUT")[0];
    expect(options.headers["if-none-match"]).toBe("*");
    expect(options.headers["if-match"]).toBeUndefined();
    expect(lastBody(api, "PUT")).toEqual({
      endpoint: "https://s3.example.com",
      region: "eu-west-2",
      bucket: "customer-documents",
      prefix: "document-extraction/",
      force_path_style: true,
      access_key_id: "AKIAEXAMPLEWXYZ",
      secret_access_key: "secret-value",
      confirm_unversioned_bucket: true,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Workspace bucket")).toBeTruthy();
    expect(screen.queryByLabelText("Secret access key")).toBeNull();
  });

  it("requires both keys when adding a bucket and validates fields on blur", async () => {
    const api = storageApi(storageRecord());
    renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add bucket…" }));
    fireEvent.blur(screen.getByLabelText("Region"));
    expect(screen.getByText("Enter a region.")).toBeTruthy();
    type("Endpoint", "not a url");
    fireEvent.blur(screen.getByLabelText("Endpoint"));
    expect(screen.getByText("Enter an address like https://s3.example.com.")).toBeTruthy();
    // The server accepts only an origin, so a path is caught on the field instead of after a save.
    type("Endpoint", "https://s3.example.com/documents");
    fireEvent.blur(screen.getByLabelText("Endpoint"));
    expect(screen.getByText("Enter an address like https://s3.example.com.")).toBeTruthy();
    type("Endpoint", "https://s3.example.com/");
    fireEvent.blur(screen.getByLabelText("Endpoint"));
    expect(screen.queryByText("Enter an address like https://s3.example.com.")).toBeNull();
    // Region, bucket and prefix follow the server's format rules on their own fields.
    type("Region", "US_EAST_1");
    fireEvent.blur(screen.getByLabelText("Region"));
    expect(screen.getByText("Use lowercase letters, numbers and hyphens, like eu-west-2.")).toBeTruthy();
    type("Bucket", "Bad_Bucket");
    fireEvent.blur(screen.getByLabelText("Bucket"));
    expect(screen.getByText(/Use 3 to 63 lowercase letters/)).toBeTruthy();
    type("Prefix", "documents");
    fireEvent.blur(screen.getByLabelText("Prefix"));
    expect(screen.getByText('Use folder names separated by "/" and end with "/", like documents/.')).toBeTruthy();
    type("Prefix", "documents/");
    fireEvent.blur(screen.getByLabelText("Prefix"));
    expect(screen.queryByText('Use folder names separated by "/" and end with "/", like documents/.')).toBeNull();
    type("Endpoint", "");
    type("Region", "eu-west-2");
    type("Bucket", "customer-documents");
    type("Access key ID", "AKIAEXAMPLEWXYZ");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Secret access key")));
    expect(screen.getByText("Enter the secret access key.")).toBeTruthy();
    expect(api.calls("PUT")).toHaveLength(0);
  });

  it("edits a saved bucket with If-Match and keeps the saved keys when both are blank", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Access key ID").value).toBe("");
    expect(screen.getByText("Leave both keys blank to keep the saved ones (…WXYZ).")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save storage" }).disabled).toBe(true);
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "success"));
    // Region alone doesn't move uploads, so nothing asks first.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const [, options] = api.calls("PUT")[0];
    expect(options.headers["if-match"]).toBe('"source-storage-3"');
    expect(options.headers["if-none-match"]).toBeUndefined();
    const body = lastBody(api, "PUT");
    expect(body.region).toBe("eu-west-1");
    expect(body).not.toHaveProperty("access_key_id");
    expect(body).not.toHaveProperty("secret_access_key");
    expect(body).not.toHaveProperty("session_token");
    expect(await screen.findByText("eu-west-1")).toBeTruthy();
  });

  it("asks for the other key when only one is replaced", async () => {
    const api = storageApi(storageRecord(savedOverride));
    renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Access key ID", "AKIANEWKEY");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    expect(await screen.findByText("Enter the secret access key.")).toBeTruthy();
    expect(api.calls("PUT")).toHaveLength(0);
  });

  it("says before saving that a new location only applies to new uploads", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Bucket", "new-bucket");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    let dialog = await screen.findByRole("alertdialog", { name: 'Move new uploads to "new-bucket"?' });
    expect(within(dialog).getByText(/Originals already saved stay where they are/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.calls("PUT")).toHaveLength(0);
    expect(screen.getByLabelText("Bucket").value).toBe("new-bucket");

    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save location" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "success"));
    expect(lastBody(api, "PUT").bucket).toBe("new-bucket");
  });

  it("tests the draft and reports the failed stage in plain language", async () => {
    const api = storageApi(storageRecord());
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Add bucket…" }));
    // A test checks the fields it needs, but not the save confirmation.
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Enter a region.")).toBeTruthy();
    expect(screen.queryByText("Confirm the bucket doesn't use versioning or Object Lock.")).toBeNull();
    expect(api.calls("TEST")).toHaveLength(0);

    type("Region", "eu-west-2");
    type("Bucket", "customer-documents");
    type("Access key ID", "AKIAEXAMPLEWXYZ");
    type("Secret access key", "secret-value");
    api.fail("TEST", apiError(422, "source_storage_test_failed", { stage: "read" }));
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() =>
      expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.test", "failure", {
        message: "Couldn't read the test file back from the bucket. Check that the access key can read files.",
      }),
    );
    expect(lastBody(api, "TEST")).not.toHaveProperty("confirm_unversioned_bucket");
    expect(lastBody(api, "TEST").access_key_id).toBe("AKIAEXAMPLEWXYZ");

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.test", "success"));
  });

  it("keeps the form open with a stage message when the save test fails", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    api.fail("PUT", apiError(422, "source_storage_test_failed", { stage: "write" }));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() =>
      expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "failure", {
        message: "Couldn't save storage settings. Couldn't write a test file to the bucket.",
      }),
    );
    expect(screen.getByLabelText("Region").value).toBe("eu-west-1");
    expect(screen.getByRole("button", { name: "Save storage" }).disabled).toBe(false);
  });

  it("tests the saved settings from the summary without sending keys", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.test", "success"));
    expect(lastBody(api, "TEST")).toEqual({
      endpoint: "https://s3.example.com",
      region: "eu-west-2",
      bucket: "customer-documents",
      prefix: "document-extraction/",
      force_path_style: true,
    });
  });

  it("reloads and says so when the settings changed elsewhere", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    api.fail("PUT", apiError(412, "precondition_failed"));
    api.replace(storageRecord({ ...savedOverride, region: "us-east-1", revision: 4 }));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() =>
      expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "failure", {
        message: "Couldn't save storage settings. This changed elsewhere. Check the latest settings and try again.",
      }),
    );
    expect(await screen.findByText("us-east-1")).toBeTruthy();
    expect(screen.queryByLabelText("Region")).toBeNull();
    expect(api.calls("GET")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "success"));
    expect(api.calls("PUT").at(-1)[1].headers["if-match"]).toBe('"source-storage-4"');
  });

  it("returns to default storage with If-Match after confirmation", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast, onChanged } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Use default storage" }));
    let dialog = await screen.findByRole("alertdialog", { name: 'Stop using "customer-documents"?' });
    expect(
      within(dialog).getByText(
        "New uploads go to default storage. Originals already in this bucket stay there and remain available.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.calls("DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Use default storage" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use default storage" }));

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.remove", "success"));
    expect(api.calls("DELETE")[0][1].headers["if-match"]).toBe('"source-storage-3"');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Default storage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add bucket…" })).toBeTruthy();
  });

  it("keeps a failed removal inside the confirmation without a toast", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Use default storage" }));
    api.fail("DELETE", apiError(500, "internal_error"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use default storage" }));

    expect(await within(dialog).findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(showActionToast).not.toHaveBeenCalled();
  });

  it("is hidden from members and never loads their storage settings", () => {
    const api = storageApi(storageRecord(savedOverride));
    const { container } = renderPanel(api, { role: "member" });

    expect(container.innerHTML).toBe("");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("explains when the operator has turned off Workspace buckets and still allows removing one", async () => {
    const api = storageApi(storageRecord(savedOverride, { overrides_enabled: false }));
    const { showActionToast } = renderPanel(api);

    expect(await screen.findByText("Bucket not in use")).toBeTruthy();
    expect(
      screen.getByText(
        "Your administrator has turned off workspace buckets, so new uploads use default storage instead of this bucket. Originals already in it stay available.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use default storage" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Use default storage" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.remove", "success"));
    expect(
      await screen.findByText("New originals use default storage. Your administrator has turned off workspace buckets."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add bucket…" })).toBeNull();
  });

  it("asks for new keys when the saved ones can't be read", async () => {
    const api = storageApi(storageRecord({ ...savedOverride, credential_status: "unavailable" }));
    renderPanel(api);

    expect(await screen.findByText("Access keys unavailable")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "The saved access keys can't be read. Edit the settings and enter new keys.",
    );
    expect(screen.getByRole("button", { name: "Test" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText(/Leave both keys blank/)).toBeNull();
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    expect(await screen.findByText("Enter the access key ID.")).toBeTruthy();
    expect(api.calls("PUT")).toHaveLength(0);
  });

  it("starts requiring new keys when a save finds the saved ones unreadable", async () => {
    const api = storageApi(storageRecord(savedOverride));
    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Region", "eu-west-1");
    fireEvent.click(screen.getByLabelText("This bucket doesn't use versioning or Object Lock"));
    api.fail("PUT", apiError(409, "source_storage_credentials_unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));

    await waitFor(() =>
      expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.save", "failure", {
        message: "Couldn't save storage settings. The saved access keys can't be read. Enter both keys again.",
      }),
    );
    expect(screen.queryByText(/Leave both keys blank/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save storage" }));
    expect(await screen.findByText("Enter the access key ID.")).toBeTruthy();
    expect(api.calls("PUT")).toHaveLength(1);
  });

  it("uses the server's field message for invalid settings and maps blocked endpoints", () => {
    expect(
      sourceStorageSaveFailure(Object.assign(apiError(400, "invalid_source_storage"), { message: "Enter a valid region." })),
    ).toBe("Couldn't save storage settings. Enter a valid region.");
    expect(sourceStorageSaveFailure(apiError(400, "source_storage_endpoint_blocked"))).toBe(
      "Couldn't save storage settings. That endpoint address isn't allowed. Use the storage service's own address.",
    );
    expect(sourceStorageTestFailure(apiError(409, "source_storage_overrides_disabled"))).toBe(
      "Test failed. Your administrator has turned off workspace buckets.",
    );
    expect(getActionToast("workspace.sourceStorage.remove", "success").message).toBe("Workspace bucket removed");
  });
});

const workspaceTarget = {
  id: "dst_new",
  kind: "workspace_bucket",
  bucket: "customer-documents",
  prefix: "document-extraction/",
  endpoint: "https://s3.example.com",
};

const spreadLocations = [
  { ...installationLocation, id: "dst_new", kind: "workspace_bucket", bucket: "customer-documents", is_target: true, originals: 4, bytes: 2048 },
  {
    ...installationLocation,
    id: "dst_old",
    kind: "workspace_bucket",
    bucket: "old-documents",
    is_target: false,
    retired: true,
    originals: 10,
    bytes: 4.5 * 1024 * 1024,
  },
  { ...installationLocation, id: "local", kind: "local", bucket: null, prefix: null, is_target: false, originals: 5, bytes: 1024 * 1024, unknown_size: 2 },
];

const spreadSummary = (extra = {}) =>
  moveSummary({ target: workspaceTarget, locations: spreadLocations, movable: 15, ...extra });

const runningMove = (extra = {}) => ({
  id: "mov_1",
  status: "running",
  target_id: "dst_new",
  started_at: "2026-10-17T10:00:00.000Z",
  finished_at: null,
  total: 15,
  moved: 0,
  bytes_moved: 0,
  failed: 0,
  waiting: 0,
  next_attempt_at: null,
  message: null,
  failures: [],
  ...extra,
});

const movingSection = () => screen.findByRole("heading", { name: "Where originals are stored" });

describe("Moving originals to the current location", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden when every original is already in the current location", async () => {
    const api = storageApi(storageRecord());
    renderPanel(api);

    expect(await screen.findByText("Default storage")).toBeTruthy();
    await waitFor(() => expect(api.calls("MOVE_GET")).toHaveLength(1));
    expect(api.calls("MOVE_GET")[0][0]).toBe("/workspaces/workspace_a/source-storage/move");
    expect(screen.queryByRole("heading", { name: "Where originals are stored" })).toBeNull();
  });

  it("lists each location with its originals and size and marks the current one", async () => {
    renderPanel(storageApi(storageRecord(savedOverride), spreadSummary()));

    await movingSection();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("This workspace's bucket");
    expect(within(items[0]).getByText("Current location")).toBeTruthy();
    expect(items[0].textContent).toContain("4 originals · 2 KB");
    expect(items[1].textContent).toContain("Earlier workspace bucket");
    expect(items[1].textContent).toContain("old-documents");
    expect(items[1].textContent).toContain("10 originals · 4.5 MB");
    expect(items[2].textContent).toContain("Local data folder");
    expect(items[2].textContent).toContain("5 originals · 1 MB (2 of unknown size)");
    expect(screen.getByRole("button", { name: "Move to current location…" })).toBeTruthy();
  });

  it("explains the move, starts it after confirmation and shows its progress", async () => {
    const api = storageApi(storageRecord(savedOverride), spreadSummary(), spreadSummary({ move: runningMove() }));
    const { showActionToast } = renderPanel(api);

    await movingSection();
    fireEvent.click(screen.getByRole("button", { name: "Move to current location…" }));
    let dialog = await screen.findByRole("alertdialog", { name: 'Move 15 originals to "customer-documents"?' });
    expect(within(dialog).getByText(/About 5.5 MB plus 2 of unknown size is copied through Studio/).textContent).toContain(
      "may charge for data leaving it",
    );
    expect(within(dialog).getByText(/Uploads and downloads keep working/)).toBeTruthy();
    expect(within(dialog).getByText(/deleted only after its new copy is checked/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.calls("MOVE_POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Move to current location…" }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move originals" }));

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.moveStart", "success"));
    const [path, options] = api.calls("MOVE_POST")[0];
    expect(path).toBe("/workspaces/workspace_a/source-storage/move");
    expect(options.body).toBe("{}");
    expect(await screen.findByText("Moving originals…")).toBeTruthy();
    expect(screen.getByText("0 of 15 originals moved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to current location…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel move…" })).toBeTruthy();
  });

  it("checks a running move every few seconds and stops once it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const api = storageApi(
      storageRecord(savedOverride),
      spreadSummary({ move: runningMove({ moved: 3 }) }),
      spreadSummary({
        move: runningMove({
          moved: 9,
          bytes_moved: 3 * 1024 * 1024,
          failed: 1,
          waiting: 2,
          next_attempt_at: "2026-10-17T10:05:00.000Z",
          message: "The Workspace bucket couldn't be reached. Retrying at 10:05.",
        }),
      }),
      spreadSummary({
        movable: 0,
        locations: [spreadLocations[0]],
        move: runningMove({ status: "completed", moved: 15, finished_at: "2026-10-17T10:06:00.000Z" }),
      }),
    );

    renderPanel(api);

    expect(await screen.findByText("3 of 15 originals moved")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(MOVE_POLL_MS);
    expect(await screen.findByText("9 of 15 originals moved (3 MB)")).toBeTruthy();
    expect(screen.getByText("Move paused")).toBeTruthy();
    expect(screen.getByText("The Workspace bucket couldn't be reached. Retrying at 10:05.")).toBeTruthy();
    expect(screen.getByText(/^Resumes at/)).toBeTruthy();
    expect(screen.getByText(/Couldn't move 1 original\. It stays where it was/)).toBeTruthy();
    expect(screen.getByText(/2 originals still processing or out of reach/)).toBeTruthy();

    await vi.advanceTimersByTimeAsync(MOVE_POLL_MS);
    expect(await screen.findByText("Move finished")).toBeTruthy();
    expect(screen.getByText("15 of 15 originals moved")).toBeTruthy();
    const checks = api.calls("MOVE_GET").length;
    await vi.advanceTimersByTimeAsync(MOVE_POLL_MS * 3);
    expect(api.calls("MOVE_GET")).toHaveLength(checks);
  });

  it("stops checking when the panel closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const api = storageApi(storageRecord(savedOverride), spreadSummary({ move: runningMove() }));
    const { unmount } = renderPanel(api);

    expect(await screen.findByText("Moving originals…")).toBeTruthy();
    unmount();
    const checks = api.calls("MOVE_GET").length;
    await vi.advanceTimersByTimeAsync(MOVE_POLL_MS * 3);
    expect(api.calls("MOVE_GET")).toHaveLength(checks);
  });

  it("cancels a running move after confirmation", async () => {
    const api = storageApi(
      storageRecord(savedOverride),
      spreadSummary({ move: runningMove({ moved: 4 }) }),
      spreadSummary({ move: runningMove({ status: "cancelled", moved: 4, finished_at: "2026-10-17T10:02:00.000Z" }) }),
    );

    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel move…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel the move?" });
    expect(within(dialog).getByText(/Originals already moved stay in the new location/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel move" }));

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.moveCancel", "success"));
    expect(api.calls("MOVE_DELETE")).toHaveLength(1);
    expect(await screen.findByText("Move cancelled")).toBeTruthy();
    expect(screen.getByText("4 of 15 originals moved")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to current location…" })).toBeTruthy();
  });

  it("a poll during a cancel doesn't swallow the cancel's result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const api = storageApi(
      storageRecord(savedOverride),
      spreadSummary({ move: runningMove({ moved: 4 }) }),
      spreadSummary({ move: runningMove({ moved: 5 }) }),
      spreadSummary({ move: runningMove({ status: "cancelled", moved: 5, finished_at: "2026-10-17T10:02:00.000Z" }) }),
    );

    const answer = api.request.getMockImplementation();
    let finishCancel;
    const cancelSent = new Promise((resolve) => (finishCancel = resolve));

    api.request.mockImplementation((path, options) =>
      kindOf(path, options) === "MOVE_DELETE" ? cancelSent.then(() => answer(path, options)) : answer(path, options),
    );

    const { showActionToast } = renderPanel(api);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel move…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel the move?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel move" }));
    await waitFor(() => expect(api.calls("MOVE_DELETE")).toHaveLength(1));

    // A poll lands while the cancel is still on its way.
    await vi.advanceTimersByTimeAsync(MOVE_POLL_MS);
    await waitFor(() => expect(api.calls("MOVE_GET")).toHaveLength(2));
    finishCancel();

    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.moveCancel", "success"));
    expect(await screen.findByText("Move cancelled")).toBeTruthy();
  });

  it("reports what couldn't be moved after a move ends", async () => {
    renderPanel(
      storageApi(
        storageRecord(savedOverride),
        spreadSummary({
          movable: 3,
          move: runningMove({
            status: "stopped",
            moved: 12,
            failed: 1,
            finished_at: "2026-10-17T10:06:00.000Z",
            message: "This workspace's storage location changed, so the move stopped.",
            failures: [
              { kind: "document", id: "job_1", name: "invoice.pdf", message: "The original is missing from its bucket." },
              { kind: "library_document", id: "lib_2", name: null, message: "The original couldn't be read." },
            ],
          }),
        }),
      ),
    );

    expect(await screen.findByText("Move stopped")).toBeTruthy();
    expect(screen.getByText("This workspace's storage location changed, so the move stopped.")).toBeTruthy();
    const failures = within(screen.getByRole("list", { name: "Originals that couldn't be moved" })).getAllByRole("listitem");
    expect(failures[0].textContent).toBe("Document: invoice.pdfThe original is missing from its bucket.");
    expect(failures[1].textContent).toBe("Library document: lib_2The original couldn't be read.");
    expect(screen.getByRole("button", { name: "Move to current location…" })).toBeTruthy();
  });

  it("explains why a move can't start", async () => {
    renderPanel(
      storageApi(
        storageRecord(null, { installation_provider: "local" }),
        moveSummary({
          target: null,
          unavailable_reason: "no_remote_storage",
          locations: [{ ...spreadLocations[2] }],
          movable: 0,
        }),
      ),
    );

    await movingSection();
    expect(screen.getByText(/Originals can only be moved into a bucket, not into the local data folder/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to current location…" })).toBeNull();
  });

  it("asks for the bucket's keys when they can't be read", async () => {
    renderPanel(
      storageApi(
        storageRecord({ ...savedOverride, credential_status: "unavailable" }),
        spreadSummary({ unavailable_reason: "credentials_unavailable" }),
      ),
    );

    await movingSection();
    expect(screen.getByText(/bucket keys can't be read\. Edit the settings and enter the access keys again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to current location…" })).toBeNull();
  });

  it("keeps a refused start inside the confirmation and refreshes the summary", async () => {
    const api = storageApi(storageRecord(savedOverride), spreadSummary(), moveSummary({ target: workspaceTarget }));
    const { showActionToast } = renderPanel(api);

    await movingSection();
    api.fail("MOVE_POST", apiError(409, "source_storage_move_nothing_to_move"));
    fireEvent.click(screen.getByRole("button", { name: "Move to current location…" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move originals" }));

    expect(await within(dialog).findByText("Every original is already in the current location.")).toBeTruthy();
    expect(showActionToast).not.toHaveBeenCalled();
    await waitFor(() => expect(api.calls("MOVE_GET")).toHaveLength(2));
  });

  it("shows a load failure with Try again", async () => {
    const api = storageApi(storageRecord(savedOverride), spreadSummary());
    api.fail("MOVE_GET", apiError(500, "internal_error"));
    renderPanel(api);

    expect(await screen.findByText("Couldn't load where originals are stored.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await movingSection()).toBeTruthy();
  });

  it("refreshes the summary after the storage settings change", async () => {
    const api = storageApi(storageRecord(savedOverride), spreadSummary());
    const { showActionToast } = renderPanel(api);

    await movingSection();
    fireEvent.click(screen.getByRole("button", { name: "Use default storage" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Use default storage" }));
    await waitFor(() => expect(showActionToast).toHaveBeenCalledWith("workspace.sourceStorage.remove", "success"));
    await waitFor(() => expect(api.calls("MOVE_GET")).toHaveLength(2));
  });

  it("maps move errors to plain language", () => {
    expect(describeError(apiError(409, "source_storage_move_unavailable"))).toBe(
      "Originals can't be moved to the current location right now.",
    );
    expect(describeError(apiError(409, "source_storage_move_running"))).toBe("A move is already running.");
    expect(describeError(apiError(409, "source_storage_move_not_running"))).toBe("The move has already finished.");
    expect(describeError(apiError(403, "insufficient_workspace_role"))).toBe("Only workspace owners and admins can do that.");
    expect(getActionToast("workspace.sourceStorage.moveStart", "success").message).toBe("Move started");
    expect(getActionToast("workspace.sourceStorage.moveCancel", "success").message).toBe("Move cancelled");
    expect(formatSize(0)).toBe("0 KB");
    expect(formatSize(200)).toBe("1 KB");
    expect(formatSize(3.25 * 1024 ** 3)).toBe("3.3 GB");
  });
});
