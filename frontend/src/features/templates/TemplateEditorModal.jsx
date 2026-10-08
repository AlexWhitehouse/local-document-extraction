import React, { useMemo, useRef, useState } from "react";
import "./TemplateEditorModal.css";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { TemplateProblems } from "./TemplateDiagnostics.jsx";
import { issueMessage, templateIssues } from "./issueMessages.js";
import { describeError } from "../../lib/describeError";
import { CloseIcon } from "../layout/Icons.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "./templateFields.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field, TextInput } from "../ui/Field.jsx";

/** Independent draft; the caller chooses temporary Apply or persistent Save. */
export function TemplateEditorModal({
  initial,
  title = "Edit template",
  action = "Apply changes",
  notice,
  onSubmit,
  onClose,
  showActionToast,
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
        <IconButton label="Close template editor" icon={CloseIcon} disabled={saving} onClick={onClose} />
      </header>
      <div ref={rootRef}>
        <div className="studio-template-meta">
          <Field label="Template name" error={issueMessage(templateIssues(issues, "name"))}>
            <TextInput
              data-diagnostic-location="template:name"
              value={draft.name}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <TextInput
              data-diagnostic-location="template:description"
              value={draft.description || ""}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </Field>
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
          showActionToast={showActionToast}
        />
      </div>
      <footer className="template-editor-modal-footer">
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="actions">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : action}
          </Button>
        </div>
      </footer>
    </ModalDialog>
  );
}
