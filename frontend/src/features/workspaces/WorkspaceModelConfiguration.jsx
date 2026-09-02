import React, { useState } from "react";
import "./WorkspaceModelConfiguration.css";

export function WorkspaceModelConfiguration({ controller }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const { record, canManage, draft, loading, saving, testing, error, conflict, feedback, testResult } = controller;
  const configured = Boolean(record?.configured);
  const unavailable = canManage && record?.credential_status === "unavailable";
  const status = loading || !record ? "Not loaded" : unavailable ? "Credential unavailable" : configured ? "Configured" : "Not configured";
  return (
    <article className="workspace-model" aria-label="Workspace Model gateway">
      <header className="workspace-model-header">
        <div>
          <div className="workspace-model-title">
            <h2>Model gateway</h2>
            <span className={`workspace-model-status ${unavailable ? "unavailable" : configured ? "configured" : ""}`}><i aria-hidden="true" />{status}</span>
          </div>
          <p>Document processing for this Workspace only.</p>
        </div>
        {canManage && configured && !expanded ? <div className="workspace-model-summary"><strong>{record.model_name}</strong><span>{record.gateway_url}</span></div> : null}
        {canManage ? <button type="button" className="secondary" aria-expanded={expanded} aria-controls="workspace-model-editor" onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse" : configured ? "Manage" : "Set up"}<span aria-hidden="true">{expanded ? " −" : " +"}</span></button> : null}
      </header>
      {!canManage ? <div className="workspace-model-member"><p>{loading || !record ? "Loading configuration status…" : configured ? "This Workspace has a Model gateway configured. An owner or admin manages its settings." : "Ask a Workspace owner or admin to set up a Model gateway before processing documents."}</p>{error ? <><p role="alert">{error}</p><button type="button" className="secondary" onClick={controller.reload}>Try again</button></> : null}</div> : expanded ? (
        <div id="workspace-model-editor" className="workspace-model-body">
          {loading ? <p role="status">Loading Workspace model configuration…</p> : !record ? <div role="alert"><p>{error || "Configuration is not available."}</p><button type="button" className="secondary" onClick={controller.reload}>Try again</button></div> : <form onSubmit={(event) => { event.preventDefault(); void controller.save(); }}>
            {!configured ? <p className="workspace-model-intro">Add an OpenAI-compatible endpoint, model, and credential to start processing documents. New Workspaces have no defaults.</p> : null}
            {unavailable ? <p className="workspace-model-repair" role="alert">The saved credential cannot be read on this machine. Enter a new credential to repair this configuration, or clear it.</p> : null}
            <fieldset disabled={saving}>
              <div className="workspace-model-fields">
                <label>Gateway URL<input aria-label="Gateway URL" type="url" required maxLength={2048} value={draft.gateway_url} onChange={(event) => controller.update("gateway_url", event.target.value)} placeholder="https://gateway.example/v1" spellCheck="false" /><small>Base URL used for <code>chat/completions</code>.</small></label>
                <label>Model name<input aria-label="Model name" required maxLength={256} value={draft.model_name} onChange={(event) => controller.update("model_name", event.target.value)} placeholder="provider/model" spellCheck="false" /><small>Use the model identifier from your gateway.</small></label>
              </div>
              <label>Gateway API key<input aria-label="Gateway API key" type="password" required={!configured || unavailable} maxLength={8192} value={draft.credential} onChange={(event) => controller.update("credential", event.target.value)} placeholder={configured && !unavailable ? "Saved — leave blank to keep, or enter a replacement" : "Enter gateway credential"} autoComplete="new-password" spellCheck="false" /><small>Encrypted on this machine and never shown again. This is separate from the Workspace API key below.</small></label>
              <details className="workspace-model-options"><summary>Capabilities &amp; call behavior</summary><p>Declarations for this model. The connection test does not verify these capabilities.</p>
                {[["supports_pdf_input", "Direct PDF input", "Send PDFs inline; otherwise render their pages as images."], ["supports_structured_output", "Structured output", "Send a response format with extraction requests."], ["sequential_calls", "Sequential calls", "One gateway request at a time for this Workspace."]].map(([field, title, note]) => <label className="workspace-model-toggle" key={field}><input type="checkbox" checked={draft[field]} onChange={(event) => controller.update(field, event.target.checked)} /><span><strong>{title}</strong><small>{note}</small></span></label>)}
              </details>
            </fieldset>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {conflict ? <button type="button" className="secondary" onClick={controller.reload}>Reload configuration</button> : null}
            {testResult ? <p role="status" className={testResult.passed ? "workspace-model-test passed" : "workspace-model-test"}>{testResult.message}</p> : null}
            {feedback ? <p role="status" className="workspace-model-test passed">{feedback}</p> : null}
            <div className="workspace-model-actions"><div><button type="submit" disabled={saving || conflict || !controller.dirty}>{saving ? "Saving…" : "Save configuration"}</button><button type="button" className="secondary" disabled={saving || testing || conflict} onClick={controller.testConnection}>{testing ? "Testing…" : "Test connection"}</button></div>{configured ? <button type="button" className="workspace-model-clear" disabled={saving || conflict} onClick={() => setConfirmClear(true)}>Clear configuration</button> : null}</div>
            <p className="workspace-model-footnote">Testing is optional and does not save. Saving does not contact the gateway.</p>
            {confirmClear ? <div className="workspace-model-confirm" role="alertdialog" aria-label="Clear Model gateway configuration"><strong>Clear this Workspace’s Model gateway?</strong><p>New document requests will be rejected. Queued jobs and retries will stop at their next attempt; in-flight attempts can finish.</p><div className="actions"><button type="button" className="danger" disabled={saving} onClick={() => { setConfirmClear(false); void controller.clear(); }}>Confirm clear</button><button type="button" className="secondary" onClick={() => setConfirmClear(false)}>Cancel</button></div></div> : null}
          </form>}
        </div>
      ) : null}
    </article>
  );
}
