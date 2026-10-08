import React, { useEffect, useMemo, useRef, useState } from "react";
import "./TemplateEditorModal.css";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { TemplateProblems } from "./TemplateDiagnostics.jsx";
import { issueMessage, templateIssues } from "./issueMessages.js";
import { describeError } from "../../lib/describeError";
import { AssistantIcon, CloseIcon } from "../layout/Icons.jsx";
import { TemplateAssistant } from "./TemplateAssistant.jsx";
import { useTemplateAssistant } from "./useTemplateAssistant.js";
import { ModalDialog, ModalDismiss } from "../layout/ModalDialog.jsx";
import { useUnsavedGuard } from "../../lib/unsavedChanges.js";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "./templateFields.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field, TextInput } from "../ui/Field.jsx";

/**
 * Independent draft; the caller chooses temporary Apply or persistent Save.
 * `assistant` mounts the Template assistant against this draft ({ request, scope, hasApiAccess,
 * maxSourceFileBytes, intent }); `intent` opens it prepared. `onTestChanges` receives the draft
 * after applied assistant edits; `testLimit` explains why a copy can't be made.
 */
export function TemplateEditorModal({
  initial,
  title = "Edit template",
  action = "Apply changes",
  notice,
  onSubmit,
  onClose,
  showActionToast,
  assistant: assistantOptions = null,
  onTestChanges = null,
  testLimit = "",
}) {
  const [draft, setDraft] = useState(() => ({
    ...structuredClone(initial),
    fields: initial.fields.map(hydrateFieldFromTemplate),
  }));

  // The opening draft, so closing and navigation ask only once something has changed.
  const [openingDraft] = useState(() => JSON.stringify(draft));
  const isDirty = useMemo(() => JSON.stringify(draft) !== openingDraft, [draft, openingDraft]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useUnsavedGuard(isDirty, "Template", { onDiscard: onClose });
  const rootRef = useRef(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);
  const issues = useMemo(() => diagnoseTemplateDraft(draft), [draft]);
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const assistantRef = useRef(null);

  // Every draft edit invalidates an open assistant request, as on the Templates page.
  const editDraft = (update) => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    assistantRef.current?.invalidate();
    setDraft(update);
  };

  const assistantDraft = useMemo(
    () => ({ name: draft.name, description: draft.description || "", fields: draft.fields }),
    [draft.name, draft.description, draft.fields],
  );

  const assistant = useTemplateAssistant({
    request: assistantOptions?.request,
    workspaceId: assistantOptions?.scope ?? "",
    sessionId: "",
    activePage: "evaluations",
    templateId: assistantOptions?.scope ?? "",
    templateVersion: null,
    hasApiAccess: Boolean(assistantOptions?.hasApiAccess),
    draft: assistantDraft,
    revision,
    getRevision: () => revisionRef.current,
    maxSourceFileBytes: assistantOptions?.maxSourceFileBytes,
    onApply: (payload) =>
      editDraft((previous) => ({
        ...previous,
        name: payload.name,
        description: payload.description,
        fields: payload.fields,
      })),
  });

  assistantRef.current = assistant;
  const intent = useRef(assistantOptions?.intent);
  const openWith = assistant.openWith;
  useEffect(() => {
    if (intent.current) openWith(intent.current);
    // Opens once with the caller's prepared request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = (issue) => {
    if (!issue) return;
    setFocusRequest({ issue, nonce: Math.random() });

    if (issue.location.scope === "template") focusDiagnostic(rootRef.current, issue.location);
  };

  const finish = async (send, fallback) => {
    let payload;

    try {
      payload = validateTemplateJsonPayload(draft);
    } catch (failure) {
      setError(describeError(failure, "Template draft is incomplete. Fix required fields before saving."));
      focus(failure.diagnostics?.[0] || issues[0]);

      return;
    }

    setSaving(true);
    setError("");

    try {
      await send(payload);
      onClose();
    } catch (failure) {
      setError(describeError(failure, fallback));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => finish(onSubmit, "Couldn't save the template. Try again.");

  const appliedView = onTestChanges
    ? {
        notice: testLimit || "Applied to this draft. Test the changes on a copy, or apply them to this candidate.",
        actions: (
          <Button
            type="button"
            disabled={saving || Boolean(testLimit)}
            onClick={() => finish(onTestChanges, "Couldn't test the changes. Try again.")}
          >
            Test changes
          </Button>
        ),
      }
    : { notice: `Applied to this draft. Select “${action}” to keep these changes.` };

  return (
    <ModalDialog
      className={`template-editor-modal${assistant.panel.isOpen ? " has-assistant" : ""}`}
      label={title}
      initialFocus="input"
      isDirty={isDirty}
      closeDisabled={saving}
      onClose={onClose}
    >
      <header className="template-editor-modal-header">
        <div>
          <h2>{title}</h2>
          {notice && <p>{notice}</p>}
        </div>
        <ModalDismiss as={IconButton} label="Close template editor" icon={CloseIcon} disabled={saving} />
      </header>
      <div ref={rootRef} className="template-editor-modal-body">
        <div className="studio-template-meta">
          <Field label="Template name" error={issueMessage(templateIssues(issues, "name"))}>
            <TextInput
              data-diagnostic-location="template:name"
              value={draft.name}
              disabled={saving}
              onChange={(event) => editDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <TextInput
              data-diagnostic-location="template:description"
              value={draft.description || ""}
              disabled={saving}
              onChange={(event) => editDraft({ ...draft, description: event.target.value })}
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
          onChange={(next) => editDraft((previous) => ({ ...previous, fields: next(previous.fields) }))}
          showActionToast={showActionToast}
        />
      </div>
      {assistantOptions ? (
        <TemplateAssistant
          assistant={assistant.panel}
          draft={assistantDraft}
          issues={issues}
          isEditing
          isDirty
          allowJobs={false}
          applied={appliedView}
        />
      ) : null}
      <footer className="template-editor-modal-footer">
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="actions">
          {assistantOptions ? (
            <Button
              type="button"
              variant="secondary"
              className="template-editor-modal-assistant"
              aria-expanded={assistant.panel.isOpen}
              disabled={saving || !assistantOptions.hasApiAccess}
              onClick={() => {
                if (!assistant.panel.isOpen) assistant.open();
              }}
            >
              <AssistantIcon />
              Assistant
            </Button>
          ) : null}
          <ModalDismiss as={Button} type="button" variant="secondary" disabled={saving}>
            Cancel
          </ModalDismiss>
          <Button type="button" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : action}
          </Button>
        </div>
      </footer>
    </ModalDialog>
  );
}
