import React, { useMemo, useRef, useState } from "react";
import "./TemplateEditorModal.css";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { DiagnosticMessages, TemplateProblems } from "./TemplateDiagnostics.jsx";
import { describeError } from "../../lib/describeError";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "./templateFields.js";

/** Independent draft; the caller chooses temporary Apply or persistent Save. */
export function TemplateEditorModal({
  initial,
  title = "Edit Template",
  action = "Apply changes",
  notice,
  onSubmit,
  onClose,
}) {
  const [draft, setDraft] = useState(() => ({
    ...structuredClone(initial),
    fields: initial.fields.map(hydrateFieldFromTemplate),
  }));

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);
  const issues = useMemo(() => diagnoseTemplateDraft(draft), [draft]);

  const focus = (issue) => {
    if (!issue) return;
    setFocusRequest({ issue, nonce: Math.random() });

    if (issue.location.scope === "template") focusDiagnostic(rootRef.current, issue.location);
  };

  const submit = async () => {
    let payload;

    try {
      payload = validateTemplateJsonPayload(draft);
    } catch (failure) {
      setError(failure.message);
      focus(failure.diagnostics?.[0] || issues[0]);

      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSubmit(payload);
      onClose();
    } catch (failure) {
      setError(describeError(failure, "Couldn't save the template. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      className="template-editor-modal"
      label={title}
      initialFocus="input"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <header className="template-editor-modal-header">
        <div>
          <h2>{title}</h2>
          {notice && <p>{notice}</p>}
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label="Close Template editor"
          disabled={saving}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div ref={rootRef}>
        <div className="studio-template-meta">
          <div>
            <label>
              Template name
              <input
                data-diagnostic-location="template:name"
                aria-describedby="evaluation-template-name-problems"
                value={draft.name}
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <DiagnosticMessages
              id="evaluation-template-name-problems"
              issues={issues.filter(
                (issue) => issue.location.scope === "template" && issue.location.property === "name",
              )}
            />
          </div>
          <label>
            Description
            <input
              data-diagnostic-location="template:description"
              value={draft.description || ""}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
        <TemplateProblems
          issues={issues}
          draft={draft}
          onFocus={focus}
          activeIndex={problemIndex}
          onIndexChange={setProblemIndex}
        />
        <TemplateFieldEditor
          diagnostics={issues}
          focusRequest={focusRequest}
          fields={draft.fields}
          disabled={saving}
          onChange={(next) => setDraft((previous) => ({ ...previous, fields: next(previous.fields) }))}
        />
      </div>
      <footer className="template-editor-modal-footer">
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : action}
          </button>
        </div>
      </footer>
    </ModalDialog>
  );
}
