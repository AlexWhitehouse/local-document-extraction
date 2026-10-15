import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSourceStorage } from "./WorkspaceSourceStorage.jsx";
import {
  sourceStorageSaveFailure,
  sourceStorageTestFailure,
  useWorkspaceSourceStorage,
} from "./useWorkspaceSourceStorage.js";
import { getActionToast } from "../../lib/toastNotifications.js";

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

// A server double for the source-storage routes. `fail(method, error)` makes the next matching request throw.
function storageApi(initial) {
  let saved = initial;
  const failures = [];

  const request = vi.fn(async (path, options) => {
    const kind = path.endsWith("/test") ? "TEST" : options.method;
    const failure = failures.findIndex((entry) => entry.kind === kind);

    if (failure >= 0) throw failures.splice(failure, 1)[0].error;

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
    calls: (kind) =>
      request.mock.calls.filter(([path, options]) => (path.endsWith("/test") ? "TEST" : options.method) === kind),
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
    expect(screen.getByText("Originals saved in earlier locations stay there until they're deleted.")).toBeTruthy();
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
