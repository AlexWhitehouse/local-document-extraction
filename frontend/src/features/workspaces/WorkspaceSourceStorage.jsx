import React, { useRef, useState } from "react";
import "./WorkspaceSourceStorage.css";
import { useUnsavedGuard } from "../../lib/unsavedChanges";
import { confirmDialog } from "../ui/confirm.jsx";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CheckboxField, Field, TextInput } from "../ui/Field.jsx";
import { ErrorState, Skeleton } from "../ui/States.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { TestConnectionButton } from "./WorkspaceModelConfiguration.jsx";
import { WorkspaceSourceStorageMove } from "./WorkspaceSourceStorageMove.jsx";
import { DEFAULT_PREFIX, locationChanged, validateStorageDraft } from "./useWorkspaceSourceStorage.js";

const FORM_ID = "workspace-storage-form";

// Field order for focusing the first problem after a submit or test.
const FIELD_ORDER = [
  "endpoint",
  "region",
  "bucket",
  "prefix",
  "access_key_id",
  "secret_access_key",
  "confirm_unversioned_bucket",
];

const UNREADABLE_KEYS_MESSAGE = "The saved access keys can't be read. Edit the settings and enter new keys.";

/** Where this workspace keeps new originals. Owners and admins only. */
export function WorkspaceSourceStorage({ controller }) {
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  const formRef = useRef(null);

  const { record, draft, loading, saving, error, canManage } = controller;
  const override = record?.override ?? null;
  const overridesEnabled = record?.overrides_enabled === true;
  const noDefault = record?.installation_provider === "none";
  const unavailable = override?.credential_status === "unavailable";
  const showForm = canManage && editing && Boolean(record) && overridesEnabled;

  const closeEditor = () => {
    setErrors({});
    setEditing(false);
  };

  useUnsavedGuard(showForm && controller.dirty, "Original document storage", {
    onDiscard: () => {
      controller.discard();
      closeEditor();
    },
  });

  if (!canManage) return null;

  const status = !record
    ? loading
      ? "Loading…"
      : "Unavailable"
    : override && !overridesEnabled
      ? "Bucket not in use"
      : unavailable
        ? "Access keys unavailable"
        : override
          ? "Workspace bucket"
          : noDefault
            ? "Not set up"
            : "Default storage";

  const statusTone = override && !overridesEnabled ? "warning" : unavailable ? "danger" : override ? "success" : "neutral";

  // Shows every problem, then focuses the first. Returns true when the draft can be sent.
  const check = (options) => {
    const problems = validateStorageDraft(draft, override, options);
    setErrors(problems);
    const first = FIELD_ORDER.find((field) => problems[field]);

    if (!first) return true;
    formRef.current?.elements.namedItem(first)?.focus();

    return false;
  };

  const checkField = (field) => {
    const problem = validateStorageDraft(draft, override)[field];

    setErrors((previous) => ({ ...previous, [field]: problem }));
  };

  const change = (field, value) => {
    controller.update(field, value);
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!check()) return;

    if (locationChanged(override, draft)) {
      const confirmed = await confirmDialog({
        title: `Move new uploads to "${draft.bucket.trim()}"?`,
        body: "Originals already saved stay where they are and remain available until they're deleted.",
        confirmLabel: "Save location",
        tone: "default",
      });

      if (!confirmed) return;
    }

    if ((await controller.save()) !== "failed") closeEditor();
  };

  const removeOverride = async () => {
    const removed = await confirmDialog({
      title: `Stop using "${override.bucket}"?`,
      body: noDefault
        ? "New uploads won't keep their originals until a bucket is added. Originals already in this bucket stay there and remain available."
        : "New uploads go to default storage. Originals already in this bucket stay there and remain available.",
      confirmLabel: noDefault ? "Remove bucket" : "Use default storage",
      pendingLabel: "Saving…",
      tone: "default",
      action: controller.remove,
    });

    if (removed) closeEditor();
  };

  const field = (name, props = {}) => ({
    name,
    value: draft[name],
    onChange: (event) => change(name, event.target.value),
    onBlur: () => checkField(name),
    spellCheck: "false",
    ...props,
  });

  const keepingKeys = Boolean(override) && !unavailable;

  return (
    <section className="studio-api-access workspace-storage" aria-label="Original document storage">
      <div className="studio-section-heading">
        <div>
          <div className="workspace-storage-title">
            <h2>Original document storage</h2>
            {record ? <StatusDot tone={statusTone} label={status} /> : null}
          </div>
          <p>Applies to new uploads.</p>
        </div>
        {record && !loading ? (
          <div className="workspace-storage-actions">
            {showForm ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    controller.discard();
                    closeEditor();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  form={FORM_ID}
                  pending={saving}
                  pendingLabel="Saving…"
                  disabled={!controller.dirty}
                >
                  Save storage
                </Button>
              </>
            ) : overridesEnabled ? (
              <>
                {override ? (
                  <TestConnectionButton
                    controller={controller}
                    disabled={saving || unavailable}
                    onTest={() => controller.testConnection({ saved: true })}
                  />
                ) : null}
                <Button variant="secondary" size="sm" disabled={saving} onClick={() => setEditing(true)}>
                  {override ? "Edit" : "Add bucket…"}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {!record && loading ? <Skeleton rows={2} height={56} label="Loading storage settings…" /> : null}
      {!record && !loading && error ? <ErrorState message={error} onRetry={controller.reload} /> : null}
      {record && !showForm ? (
        <StorageSummary
          record={record}
          saving={saving}
          onRemove={removeOverride}
          removeLabel={noDefault ? "Remove bucket" : "Use default storage"}
        />
      ) : null}
      {record && !showForm && controller.move ? <WorkspaceSourceStorageMove controller={controller.move} /> : null}
      {showForm ? (
        <form ref={formRef} id={FORM_ID} className="workspace-storage-form" noValidate onSubmit={submit}>
          {unavailable ? (
            <Callout tone="danger" role="alert">
              {UNREADABLE_KEYS_MESSAGE}
            </Callout>
          ) : null}
          <fieldset disabled={saving}>
            <Field label="Endpoint" hint="Leave blank for AWS S3." error={errors.endpoint}>
              <TextInput {...field("endpoint", { type: "url", maxLength: 2048, placeholder: "https://s3.example.com" })} />
            </Field>
            <div className="workspace-storage-pair">
              <Field label="Region" error={errors.region}>
                <TextInput {...field("region", { required: true, maxLength: 128, placeholder: "eu-west-2" })} />
              </Field>
              <Field label="Bucket" error={errors.bucket}>
                <TextInput {...field("bucket", { required: true, maxLength: 255, placeholder: "customer-documents" })} />
              </Field>
            </div>
            <Field
              label="Prefix"
              hint={`Originals are saved under this path. Leave blank for ${DEFAULT_PREFIX}`}
              error={errors.prefix}
            >
              <TextInput {...field("prefix", { maxLength: 512 })} />
            </Field>
            <CheckboxField
              name="force_path_style"
              label="Path-style addressing"
              description="Most S3-compatible services need this. AWS S3 doesn't."
              checked={draft.force_path_style}
              onChange={(checked) => change("force_path_style", checked)}
            />
            <div className="workspace-storage-pair">
              <Field
                label="Access key ID"
                hint={keepingKeys ? `Leave both keys blank to keep the saved ones (${override.access_key_id_hint}).` : undefined}
                error={errors.access_key_id}
              >
                <TextInput {...field("access_key_id", { required: !keepingKeys, maxLength: 256, autoComplete: "off" })} />
              </Field>
              <Field
                label="Secret access key"
                hint={keepingKeys ? undefined : "Stored encrypted and never shown again."}
                error={errors.secret_access_key}
              >
                <TextInput
                  {...field("secret_access_key", {
                    type: "password",
                    required: !keepingKeys,
                    maxLength: 8192,
                    autoComplete: "new-password",
                  })}
                />
              </Field>
            </div>
            <Field label="Session token (optional)" hint="Only for temporary access keys.">
              <TextInput
                {...field("session_token", { type: "password", maxLength: 8192, autoComplete: "new-password", onBlur: undefined })}
              />
            </Field>
            <CheckboxField
              name="confirm_unversioned_bucket"
              label="This bucket doesn't use versioning or Object Lock"
              description="Otherwise deleted documents could still be recovered from the bucket."
              error={errors.confirm_unversioned_bucket}
              checked={draft.confirm_unversioned_bucket}
              onChange={(checked) => change("confirm_unversioned_bucket", checked)}
            />
          </fieldset>
          <div className="workspace-storage-footer">
            <TestConnectionButton
              controller={controller}
              disabled={saving}
              onTest={() => {
                if (check({ forSave: false })) void controller.testConnection();
              }}
            />
            <small>Saving runs the same test first.</small>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function StorageSummary({ record, saving, onRemove, removeLabel }) {
  const override = record.override;
  const overridesEnabled = record.overrides_enabled === true;
  const noDefault = record.installation_provider === "none";

  const intro = override
    ? overridesEnabled
      ? "New originals are saved in this workspace's own bucket."
      : noDefault
        ? "Your administrator has turned off workspace buckets, so new uploads don't use this bucket or keep their originals. Originals already in it stay available."
        : "Your administrator has turned off workspace buckets, so new uploads use default storage instead of this bucket. Originals already in it stay available."
    : noDefault
      ? overridesEnabled
        ? "Add a bucket to keep original documents in this workspace."
        : "Original documents can't be kept. Your administrator has turned off workspace buckets."
      : overridesEnabled
        ? "New originals use default storage. You can add this workspace's own bucket instead."
        : "New originals use default storage. Your administrator has turned off workspace buckets.";

  return (
    <div className="workspace-storage-summary">
      <p className="workspace-storage-note">{intro}</p>
      {override?.credential_status === "unavailable" ? (
        <Callout tone="danger" role="alert">
          {overridesEnabled ? UNREADABLE_KEYS_MESSAGE : "The saved access keys can't be read."}
        </Callout>
      ) : null}
      {override ? (
        <dl className="studio-workspace-facts workspace-storage-facts">
          <div>
            <dt>Endpoint</dt>
            <dd>{override.endpoint ? <code>{override.endpoint}</code> : "AWS S3"}</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>
              <code>{override.region}</code>
            </dd>
          </div>
          <div>
            <dt>Bucket</dt>
            <dd>
              <code>{override.bucket}</code>
            </dd>
          </div>
          <div>
            <dt>Prefix</dt>
            <dd>{override.prefix ? <code>{override.prefix}</code> : "—"}</dd>
          </div>
          <div>
            <dt>Addressing</dt>
            <dd>{override.force_path_style ? "Path style" : "Virtual-hosted style"}</dd>
          </div>
          <div>
            <dt>Access key</dt>
            <dd>
              {override.credential_status === "unavailable" ? (
                <Badge tone="danger">Unavailable</Badge>
              ) : (
                <code>{override.access_key_id_hint || "Saved"}</code>
              )}
            </dd>
          </div>
        </dl>
      ) : null}
      {record.previous_locations_pending > 0 ? (
        <p className="workspace-storage-note">Originals saved in earlier locations stay there until they're moved or deleted.</p>
      ) : null}
      {override ? (
        <div>
          <Button variant="text" disabled={saving} onClick={onRemove}>
            {removeLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
