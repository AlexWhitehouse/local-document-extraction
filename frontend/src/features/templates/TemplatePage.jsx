import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { TemplateTags } from "./TemplateTags.jsx";
import { TemplateAssistant } from "./TemplateAssistant.jsx";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { TemplateProblems } from "./TemplateDiagnostics.jsx";
import { issueMessage, templateIssues } from "./issueMessages.js";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";
import { pluralize } from "../../lib/text.js";
import { Button } from "../ui/Button.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
import { CountBadge } from "../ui/Status.jsx";
import { AssistantIcon } from "../layout/Icons.jsx";

export function TemplatePage({
  templateName,
  templateDescription,
  templateTags = [],
  tagPicker = {},
  onTemplateTagsChange,
  isManagingTags = false,
  tagPickerKey,
  templateFields,
  isEditingTemplate,
  isSavingTemplate,
  isGeneratingTemplate = false,
  isEditedTemplateDirty,
  hasApiAccess,
  onTemplateNameChange,
  onTemplateDescriptionChange,
  onTemplateFieldsChange,
  onSaveTemplate,
  assistant,
  onOpenAssistant,
  validationFocus,
}) {
  const rootRef = useRef(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);

  const draft = useMemo(
    () => ({ name: templateName, description: templateDescription, fields: templateFields }),
    [templateName, templateDescription, templateFields],
  );

  const issues = useMemo(() => diagnoseTemplateDraft(draft), [draft]);

  const focus = useCallback((issue) => {
    if (!issue) return;
    setFocusRequest({ issue, nonce: Date.now() + Math.random() });

    if (issue.location.scope === "template") focusDiagnostic(rootRef.current, issue.location);
  }, []);

  useEffect(() => {
    focus(validationFocus?.issue);
  }, [validationFocus, focus]);

  const isSaveDisabled =
    isSavingTemplate ||
    isManagingTags ||
    isGeneratingTemplate ||
    !hasApiAccess ||
    (isEditingTemplate && !isEditedTemplateDirty);

  return (
    <div className={`template-editor-workspace${assistant?.isOpen ? " template-assistant-layout" : ""}`}>
      <section ref={rootRef} className="studio-template-page" aria-label="Template editor">
        <div className="studio-template-meta template-meta-with-tags">
          <Field label="Template name" error={issueMessage(templateIssues(issues, "name"))}>
            <TextInput
              data-tour="template-name"
              data-diagnostic-location="template:name"
              value={templateName}
              disabled={isSavingTemplate || isManagingTags || isGeneratingTemplate || !hasApiAccess}
              onChange={(event) => onTemplateNameChange(event.target.value)}
            />
          </Field>
          <Field label="Description" error={issueMessage(templateIssues(issues, "description"))}>
            <TextInput
              data-diagnostic-location="template:description"
              value={templateDescription}
              disabled={isSavingTemplate || isManagingTags || isGeneratingTemplate || !hasApiAccess}
              onChange={(event) => onTemplateDescriptionChange(event.target.value)}
            />
          </Field>
          <TemplateTags
            key={tagPickerKey}
            value={templateTags}
            onChange={onTemplateTagsChange}
            {...tagPicker}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
          />
        </div>
        <TemplateProblems
          issues={issues}
          draft={draft}
          activeIndex={problemIndex}
          onIndexChange={setProblemIndex}
          onFocus={focus}
          blocked={validationFocus?.nonce ?? null}
        />
        <TemplateFieldEditor
          fields={templateFields}
          diagnostics={issues}
          focusRequest={focusRequest}
          onChange={onTemplateFieldsChange}
          disabled={isSavingTemplate || isManagingTags || isGeneratingTemplate || !hasApiAccess}
        />
        <footer className="studio-editor-footer">
          <span>
            {pluralize(templateFields.length, "field")} ·{" "}
            <span
              className={
                isEditingTemplate
                  ? isEditedTemplateDirty
                    ? "template-footer-unsaved"
                    : "template-footer-saved"
                  : undefined
              }
            >
              {isEditingTemplate ? (isEditedTemplateDirty ? "Unsaved changes" : "All changes saved") : "New template"}
            </span>
            {issues.length ? (
              <span className="template-footer-problems">
                {" "}
                · {issues.length} problem{issues.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
          <span className="template-footer-actions">
            <Button
              variant="primary"
              data-tour="save-template"
              disabled={isSaveDisabled}
              pending={isSavingTemplate}
              pendingLabel="Saving…"
              onClick={onSaveTemplate}
            >
              {isEditingTemplate ? "Save changes" : "Save new template"}
            </Button>
            {/* One entry point: it opens on Explain problems while the draft has problems, otherwise on Propose edits. */}
            <Button
              type="button"
              variant="secondary"
              className="template-assistant-button"
              aria-expanded={Boolean(assistant?.isOpen)}
              disabled={isSavingTemplate || isManagingTags || isGeneratingTemplate || !hasApiAccess}
              onClick={() => {
                if (!assistant?.isOpen) onOpenAssistant();
              }}
            >
              <AssistantIcon />
              Assistant
              {issues.length ? <CountBadge count={issues.length} label={`${issues.length} problems`} tone="danger" /> : null}
            </Button>
          </span>
        </footer>
      </section>
      <TemplateAssistant
        assistant={assistant}
        draft={draft}
        issues={issues}
        isEditing={isEditingTemplate}
        isDirty={isEditedTemplateDirty}
      />
    </div>
  );
}
