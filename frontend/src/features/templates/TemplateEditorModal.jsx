import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "./templateFields.js";

/** Independent draft; the caller chooses temporary Apply or persistent Save. */
export function TemplateEditorModal({ initial, title = "Edit Template", action = "Apply changes", notice, onSubmit, onClose }) {
  const [draft, setDraft] = useState(() => ({ ...structuredClone(initial), fields: initial.fields.map(hydrateFieldFromTemplate) }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);
  const submit = async () => {
    try {
      const payload = validateTemplateJsonPayload(draft);
      setSaving(true); setError("");
      await onSubmit(payload);
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  const keyboard = event => {
    // Nested column editors own their keyboard handling.
    if (!dialog.current.contains(event.target)) return;
    if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return createPortal(<div className="modal-backdrop" onClick={() => !saving && onClose()}>
    <div ref={dialog} className="modal-card evaluation-template-editor" role="dialog" aria-modal="true" aria-label={title} onKeyDown={keyboard} onClick={event => event.stopPropagation()}>
      <h2>{title}</h2>{notice && <p className="hint">{notice}</p>}
      <div className="studio-template-meta">
        <label>Template name<input value={draft.name} disabled={saving} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Description<input value={draft.description || ""} disabled={saving} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      </div>
      <TemplateFieldEditor fields={draft.fields} disabled={saving} onChange={next => setDraft(previous => ({ ...previous, fields: typeof next === "function" ? next(previous.fields) : next }))} />
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="button" disabled={saving} onClick={submit}>{saving ? "Saving…" : action}</button></div>
    </div>
  </div>, document.body);
}
