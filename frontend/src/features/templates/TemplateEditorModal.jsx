import React, { useState } from "react";
import "./TemplateEditorModal.css";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "./templateFields.js";

/** Independent draft; the caller chooses temporary Apply or persistent Save. */
export function TemplateEditorModal({ initial, title = "Edit Template", action = "Apply changes", notice, onSubmit, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...structuredClone(initial), fields: initial.fields.map(hydrateFieldFromTemplate) }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    try {
      const payload = validateTemplateJsonPayload(draft);
      setSaving(true); setError("");
      await onSubmit(payload);
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <ModalDialog className="studio-main template-editor-modal" label={title} initialFocus="input" onClose={() => { if (!saving) onClose(); }}>
    <header className="template-editor-modal-header">
      <div><h2>{title}</h2>{notice && <p>{notice}</p>}</div>
      <button type="button" className="icon-action-button template-editor-modal-close" aria-label="Close Template editor" disabled={saving} onClick={onClose}>×</button>
    </header>
    <div className="studio-template-meta">
      <label>Template name<input value={draft.name} disabled={saving} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Description<input value={draft.description || ""} disabled={saving} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
    </div>
    <TemplateFieldEditor fields={draft.fields} disabled={saving} onChange={next => setDraft(previous => ({ ...previous, fields: typeof next === "function" ? next(previous.fields) : next }))} />
    <footer className="template-editor-modal-footer">
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={saving} onClick={submit}>{saving ? "Saving…" : action}</button></div>
    </footer>
  </ModalDialog>;
}
