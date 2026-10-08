import React, { useState } from "react";
import "./WorkspaceModelConfiguration.css";
import { useUnsavedGuard } from "../../lib/unsavedChanges";
import { confirmDialog } from "../ui/confirm.jsx";
import { Button } from "../ui/Button.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { CheckboxField, Field, TextInput } from "../ui/Field.jsx";

const TASK_ROLES = [
  ["assistant", "Template assistant", "Template assistant and auto-generate"],
  ["classification", "Document classification & splitting", "Choosing templates and splitting PDFs"],
];

const CAPABILITIES = [
  [
    "supports_pdf_input",
    "Direct PDF input",
    "PDF input",
    "Sends PDFs inline instead of as page images.",
  ],
  [
    "supports_structured_output",
    "Structured output",
    "JSON output",
    "Sends a JSON response format with requests.",
  ],
];

const FORM_ID = "workspace-model-form";

const UNREADABLE_API_KEY_MESSAGE = "The saved API key can't be read. Enter it again or clear the gateway.";

export function WorkspaceModelConfiguration({ controller }) {
  const [editing, setEditing] = useState(false);

  const { record, canManage, draft, loading, saving, error, conflict } = controller;

  const configured = Boolean(record?.configured);
  const unavailable = canManage && record?.credential_status === "unavailable";

  const status =
    loading || !record
      ? "Loading…"
      : unavailable
        ? "Credential unavailable"
        : configured
          ? "Configured"
          : "Not configured";

  const statusTone = unavailable ? "danger" : configured ? "success" : "neutral";

  // Every Workspace opens on the summary; editing is an explicit action.
  const showForm = canManage && Boolean(record) && (editing || conflict);
  const showSummary = canManage && !loading && Boolean(record) && !showForm;

  useUnsavedGuard(Boolean(showForm && controller.dirty), "Model gateway");

  const closeEditor = () => {
    setEditing(false);
  };

  const clearGateway = async () => {
    const cleared = await confirmDialog({
      title: "Clear the Model gateway?",
      body: "Documents can't be processed in this workspace until a gateway is set up again.",
      confirmLabel: "Clear gateway",
      pendingLabel: "Clearing…",
      action: async () => {
        if (!(await controller.clear({ inline: true }))) {
          throw new Error("The Model gateway couldn't be cleared.");
        }
      },
    });

    if (cleared) closeEditor();
  };

  return (
    <article data-tour="model-configuration" className="workspace-model" aria-label="Model gateway">
      <header className="workspace-model-header">
        <div>
          <div className="workspace-model-title">
            <h2>Model gateway</h2>
            <StatusDot tone={statusTone} label={status} />
          </div>
        </div>
        {showSummary || showForm ? (
          <div className="workspace-model-header-actions">
            {showSummary ? (
              <>
                <TestConnectionButton controller={controller} disabled={!configured || saving} />
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            ) : (
              <>
                {!conflict ? (
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      controller.discard();
                      closeEditor();
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  form={FORM_ID}
                  pending={saving}
                  pendingLabel="Saving…"
                  disabled={conflict || !controller.dirty}
                >
                  Save configuration
                </Button>
              </>
            )}
          </div>
        ) : null}
      </header>
      {!canManage ? (
        <div className="workspace-model-member">
          <p>
            {loading || !record
              ? "Loading…"
              : configured
                ? "This workspace has a Model gateway. An owner or admin manages its settings."
                : "Ask a Workspace owner or admin to set up a Model gateway before processing documents."}
          </p>
          {error ? (
            <>
              <p className="form-error" role="alert">
                {error}
              </p>
              <Button variant="secondary" onClick={controller.reload}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="workspace-model-body">
          {loading ? (
            <p role="status">Loading…</p>
          ) : !record ? (
            <div role="alert">
              <p className="form-error">{error || "Configuration is not available."}</p>
              <Button variant="secondary" onClick={controller.reload}>
                Try again
              </Button>
            </div>
          ) : showSummary ? (
            <div className="workspace-model-summary">
              <ConnectionTestResult result={controller.testResult} />
              {unavailable ? (
                <p className="workspace-model-repair" role="alert">
                  {UNREADABLE_API_KEY_MESSAGE}
                </p>
              ) : null}
              <dl className="workspace-model-connection">
                <div>
                  <dt>Gateway URL</dt>
                  <dd>
                    <code>{configured ? record.gateway_url : "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>API key</dt>
                  <dd>{unavailable ? <Badge tone="danger">Unavailable</Badge> : configured ? "Saved" : "—"}</dd>
                </div>
                <div>
                  <dt>Calls</dt>
                  <dd>{configured ? (record.sequential_calls ? "Sequential" : "Parallel") : "—"}</dd>
                </div>
              </dl>
              <ModelRoles record={record} />
            </div>
          ) : (
            <form
              id={FORM_ID}
              className="workspace-model-summary"
              onSubmit={async (event) => {
                event.preventDefault();

                if (await controller.save()) closeEditor();
              }}
            >
              {!configured ? (
                <p className="workspace-model-intro">
                  Add an OpenAI-compatible endpoint, model and API key to start processing documents.
                </p>
              ) : null}
              {unavailable ? (
                <p className="workspace-model-repair" role="alert">
                  {UNREADABLE_API_KEY_MESSAGE}
                </p>
              ) : null}
              <fieldset disabled={saving}>
                <div className="workspace-model-settings">
                  <Field label="Gateway URL">
                    <TextInput
                      type="url"
                      required
                      maxLength={2048}
                      value={draft.gateway_url}
                      onChange={(event) => controller.update("gateway_url", event.target.value)}
                      placeholder="https://gateway.example/v1"
                      spellCheck="false"
                    />
                  </Field>
                  <Field
                    label="Gateway API key"
                    hint={
                      configured && !unavailable
                        ? "Leave blank to keep the saved key."
                        : "Stored encrypted and never shown again."
                    }
                  >
                    <TextInput
                      type="password"
                      required={!configured || unavailable}
                      maxLength={8192}
                      value={draft.credential}
                      onChange={(event) => controller.update("credential", event.target.value)}
                      autoComplete="new-password"
                      spellCheck="false"
                    />
                  </Field>
                  <div className="ui-field">
                    <span className="ui-field-label">Calls</span>
                    <CheckboxField
                      label="Sequential calls"
                      description="One request at a time for this workspace."
                      checked={draft.sequential_calls}
                      onChange={(checked) => controller.update("sequential_calls", checked)}
                    />
                  </div>
                </div>
                <ModelRolesEditor draft={draft} update={controller.update} />
              </fieldset>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              {conflict ? (
                <Button variant="secondary" onClick={controller.reload}>
                  Reload
                </Button>
              ) : null}
              <small>Tick what each model supports. Test connection doesn't check these.</small>
              <div className="workspace-model-footer">
                <div>
                  <TestConnectionButton controller={controller} disabled={saving || conflict} />
                  <ConnectionTestResult result={controller.testResult} />
                </div>
                {configured ? (
                  <Button variant="danger-text" disabled={saving || conflict} onClick={clearGateway}>
                    Clear configuration
                  </Button>
                ) : null}
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function TestConnectionButton({ controller, disabled }) {
  return (
    <Button
      variant="secondary"
      pending={controller.testing}
      pendingLabel="Testing…"
      disabled={disabled}
      onClick={controller.testConnection}
    >
      Test connection
    </Button>
  );
}

// Connection test state shows beside its button; it is not an action outcome, so it is not toasted.
function ConnectionTestResult({ result }) {
  if (!result) return null;

  return (
    <span role="status" className={result.passed ? "workspace-model-test-result" : "workspace-model-test-result form-error"}>
      {result.message}
    </span>
  );
}

function RoleHeading({ title, note }) {
  return (
    <th scope="row">
      {title}
      <small>{note}</small>
    </th>
  );
}

function RolesTable({ label, children }) {
  return (
    <DataTable className="workspace-model-roles" label={label}>
      <thead>
        <tr>
          <th scope="col">Used for</th>
          <th scope="col">Model</th>
          {CAPABILITIES.map(([field, , short, detail]) => (
            <th scope="col" key={field} title={detail}>
              {short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </DataTable>
  );
}

/** Read-only view of which model each use calls. */
function ModelRoles({ record }) {
  const capability = (values, field, title) => (
    <td key={field}>
      {record.configured ? (
        <span className={values[field] ? "workspace-model-flag on" : "workspace-model-flag"}>
          <span className="sr-only">{`${title}: ${values[field] ? "yes" : "no"}`}</span>
        </span>
      ) : (
        <span aria-label={`${title}: not configured`}>—</span>
      )}
    </td>
  );

  return (
    <RolesTable label="Models">
      <tr>
        <RoleHeading title="Extraction" note="Documents and evaluations" />
        <td>
          <code>{record.configured ? record.model_name : "—"}</code>
        </td>
        {CAPABILITIES.map(([field, title]) => capability(record, field, title))}
      </tr>
      {TASK_ROLES.map(([role, title, note]) => {
        const model = record[`${role}_model`];

        return (
          <tr key={role} className={record.configured && !model ? "inherited" : ""}>
            <RoleHeading title={title} note={note} />
            <td>
              {!record.configured ? (
                "—"
              ) : model ? (
                <code>{model.model_name}</code>
              ) : (
                <span className="workspace-model-inherited">Same as extraction</span>
              )}
            </td>
            {CAPABILITIES.map(([field, capabilityTitle]) => capability(model ?? record, field, capabilityTitle))}
          </tr>
        );
      })}
    </RolesTable>
  );
}

function ModelRolesEditor({ draft, update }) {
  return (
    <RolesTable label="Models">
      <tr>
        <RoleHeading title="Extraction" note="Documents and evaluations" />
        <td>
          <Field label="Extraction model" labelHidden>
            <TextInput
              required
              maxLength={256}
              value={draft.model_name}
              onChange={(event) => update("model_name", event.target.value)}
              placeholder="provider/model"
              spellCheck="false"
            />
          </Field>
        </td>
        {CAPABILITIES.map(([field, title]) => (
          <td key={field}>
            <input
              type="checkbox"
              aria-label={`Extraction: ${title}`}
              checked={draft[field]}
              onChange={(event) => update(field, event.target.checked)}
            />
          </td>
        ))}
      </tr>
      {TASK_ROLES.map(([role, title, note]) => {
        const custom = draft[`${role}_mode`] === "custom";

        return (
          <tr key={role} className={custom ? "" : "inherited"}>
            <RoleHeading title={title} note={note} />
            <td>
              <div className="workspace-model-role-model">
                <select
                  aria-label={`${title} model source`}
                  value={draft[`${role}_mode`]}
                  onChange={(event) => update(`${role}_mode`, event.target.value)}
                >
                  <option value="same">Same as extraction</option>
                  <option value="custom">Different model</option>
                </select>
                {custom ? (
                  <Field label={`${title} model`} labelHidden>
                    <TextInput
                      required
                      maxLength={256}
                      value={draft[`${role}_model_name`]}
                      onChange={(event) => update(`${role}_model_name`, event.target.value)}
                      placeholder="provider/model"
                      spellCheck="false"
                    />
                  </Field>
                ) : null}
              </div>
            </td>
            {CAPABILITIES.map(([field, capabilityTitle]) => (
              <td key={field}>
                <input
                  type="checkbox"
                  aria-label={`${title}: ${capabilityTitle}`}
                  checked={custom ? draft[`${role}_${field}`] : draft[field]}
                  disabled={!custom}
                  onChange={(event) => update(`${role}_${field}`, event.target.checked)}
                />
              </td>
            ))}
          </tr>
        );
      })}
    </RolesTable>
  );
}
