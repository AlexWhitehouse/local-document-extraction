import React, { useState } from "react";
import "./WorkspaceModelConfiguration.css";
import { useUnsavedGuard } from "../../lib/unsavedChanges";
import { confirmDialog } from "../ui/confirm.jsx";
import { Button } from "../ui/Button.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { CheckboxField, Field, TextInput } from "../ui/Field.jsx";

const TASK_ROLES = [
  ["assistant", "Template assistant", "Assistant, suggestions and Auto generate"],
  ["classification", "Document classification & splitting", "Template selection and document boundaries"],
];

const CAPABILITIES = [
  ["supports_pdf_input", "Direct PDF input", "PDF"],
  ["supports_structured_output", "Structured output", "Structured"],
];

export function WorkspaceModelConfiguration({ controller }) {
  const [editing, setEditing] = useState(false);

  const { record, canManage, draft, loading, saving, testing, error, conflict } = controller;

  const configured = Boolean(record?.configured);
  const unavailable = canManage && record?.credential_status === "unavailable";

  const status =
    loading || !record
      ? "Not loaded"
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
    <article data-tour="model-configuration" className="workspace-model" aria-label="Workspace Model gateway">
      <header className="workspace-model-header">
        <div>
          <div className="workspace-model-title">
            <h2>Model gateway</h2>
            <StatusDot tone={statusTone} label={status} />
          </div>
          <p>LLM Gateway settings for this workspace only.</p>
        </div>
        {showSummary ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </header>
      {!canManage ? (
        <div className="workspace-model-member">
          <p>
            {loading || !record
              ? "Loading configuration status…"
              : configured
                ? "This Workspace has a Model gateway configured. An owner or admin manages its settings."
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
            <p role="status">Loading Workspace model configuration…</p>
          ) : !record ? (
            <div role="alert">
              <p className="form-error">{error || "Configuration is not available."}</p>
              <Button variant="secondary" onClick={controller.reload}>
                Try again
              </Button>
            </div>
          ) : showSummary ? (
            <div className="workspace-model-summary">
              {unavailable ? (
                <p className="workspace-model-repair" role="alert">
                  The saved credential cannot be read on this machine. Edit the configuration to enter a new credential,
                  or clear it.
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
              <div className="workspace-model-actions">
                <div>
                  <Button
                    variant="secondary"
                    pending={testing}
                    pendingLabel="Testing…"
                    disabled={!configured || saving}
                    onClick={controller.testConnection}
                  >
                    Test connection
                  </Button>
                  <ConnectionTestResult result={controller.testResult} />
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();

                if (await controller.save()) closeEditor();
              }}
            >
              {!configured ? (
                <p className="workspace-model-intro">
                  Add an OpenAI-compatible endpoint, model, and credential to start processing documents. New Workspaces
                  have no defaults.
                </p>
              ) : null}
              {unavailable ? (
                <p className="workspace-model-repair" role="alert">
                  The saved credential cannot be read on this machine. Enter a new credential to repair this
                  configuration, or clear it.
                </p>
              ) : null}
              <fieldset disabled={saving}>
                <div className="workspace-model-group">
                  <h3>Connection</h3>
                  <div className="workspace-model-fields">
                    <Field label="Gateway URL" hint="Your OpenAI-compatible base URL.">
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
                  </div>
                  <CheckboxField
                    label="Sequential calls"
                    description="One gateway request at a time for this Workspace."
                    checked={draft.sequential_calls}
                    onChange={(checked) => controller.update("sequential_calls", checked)}
                  />
                </div>
                <div className="workspace-model-group">
                  <h3>Models</h3>
                  <ModelRolesEditor draft={draft} update={controller.update} />
                  <small>
                    Capabilities are declarations for each model; the connection test does not verify them. Direct PDF
                    input sends PDFs inline instead of page images. Structured output sends a response format with
                    requests.
                  </small>
                </div>
              </fieldset>
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
              {conflict ? (
                <Button variant="secondary" onClick={controller.reload}>
                  Reload configuration
                </Button>
              ) : null}
              <div className="workspace-model-actions">
                <div>
                  {!conflict ? (
                    <Button
                      variant="ghost"
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
                    variant="secondary"
                    pending={testing}
                    pendingLabel="Testing…"
                    disabled={saving || conflict}
                    onClick={controller.testConnection}
                  >
                    Test connection
                  </Button>
                  <ConnectionTestResult result={controller.testResult} />
                  <Button type="submit" pending={saving} pendingLabel="Saving…" disabled={conflict || !controller.dirty}>
                    Save configuration
                  </Button>
                </div>
                {configured ? (
                  <Button variant="danger-text" disabled={saving || conflict} onClick={clearGateway}>
                    Clear configuration
                  </Button>
                ) : null}
              </div>
              <p className="workspace-model-footnote">
                Testing is optional and does not save. Saving does not contact the gateway.
              </p>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

// Connection test state stays beside the Test button; it is not an action outcome, so it is not toasted.
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
          {CAPABILITIES.map(([field, title, short]) => (
            <th scope="col" key={field} title={title}>
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
        <RoleHeading title="Extraction" note="Jobs and Evaluations" />
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
        <RoleHeading title="Extraction" note="Jobs and Evaluations" />
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
