import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { TemplateAssistant } from "./TemplateAssistant.jsx";
import { focusDiagnostic } from "./focusDiagnostic.js";
import { DiagnosticMessages, TemplateProblems } from "./TemplateDiagnostics.jsx";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";

export function TemplatePage({
  templateName,
  templateDescription,
  templateFields,
  isEditingTemplate,
  isSavingTemplate,
  isGeneratingTemplate = false,
  isEditedTemplateDirty,
  hasApiAccess,
  onTemplateNameChange,
  onTemplateDescriptionChange,
  onTemplateFieldsChange,
  onOpenJsonModal,
  onSaveTemplate,
  assistant, onOpenAssistant, validationFocus,
}) {
  const rootRef = useRef(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);
  const draft = useMemo(() => ({ name: templateName, description: templateDescription, fields: templateFields }), [templateName, templateDescription, templateFields]);
  const issues = useMemo(() => diagnoseTemplateDraft(draft), [draft]);
  const focus = useCallback(issue => { if (!issue) return; setFocusRequest({ issue, nonce: Date.now() + Math.random() }); if (issue.location.scope === "template") focusDiagnostic(rootRef.current, issue.location); }, []);
  useEffect(() => { focus(validationFocus?.issue); }, [validationFocus, focus]);
  const saveAction = (
    <button
      type="button"
      className="studio-text-button studio-save-action"
      data-tour="save-template"
      disabled={
        isSavingTemplate || isGeneratingTemplate ||
        !hasApiAccess ||
        (isEditingTemplate && !isEditedTemplateDirty)
      }
      onClick={onSaveTemplate}
    >
      {isSavingTemplate
        ? "Saving…"
        : isEditingTemplate
          ? "Save changes"
          : "Save new template"}
    </button>
  );

  return (
    <div className={`template-editor-workspace${assistant?.isOpen ? " template-assistant-layout" : ""}`}>
    <section ref={rootRef} className="studio-template-page" aria-label="Template editor">
      <div className="studio-template-meta">
        <div><label>
          Template name
          <input
            data-tour="template-name"
            data-diagnostic-location="template:name"
            aria-invalid={issues.some(issue => issue.location.scope === "template" && issue.location.property === "name")}
            aria-describedby="template-name-problems"
            value={templateName}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
            onChange={(event) => onTemplateNameChange(event.target.value)}
          />
        </label>
        <DiagnosticMessages id="template-name-problems" issues={issues.filter(issue => issue.location.scope === "template" && issue.location.property === "name")} /></div>
        <div><label>
          Description
          <input
            data-diagnostic-location="template:description"
            aria-describedby="template-description-problems"
            value={templateDescription}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
            onChange={(event) =>
              onTemplateDescriptionChange(event.target.value)
            }
          />
        </label>
        <DiagnosticMessages id="template-description-problems" issues={issues.filter(issue => issue.location.scope === "template" && issue.location.property === "description")} /></div>
      </div>
      <TemplateProblems issues={issues} draft={draft} activeIndex={problemIndex} onIndexChange={setProblemIndex} onFocus={focus} blocked={validationFocus?.nonce ?? null} />
      <TemplateFieldEditor
        fields={templateFields}
        diagnostics={issues}
        focusRequest={focusRequest}
        onChange={onTemplateFieldsChange}
        saveAction={saveAction}
        jsonAction={
          <button
            type="button"
            className="studio-text-button"
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
            onClick={onOpenJsonModal}
          >
            View JSON
          </button>
        }
        disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
      />
      <footer className="studio-editor-footer">
        <span>
          <span>
            {templateFields.length} fields ·{" "}
            {isEditingTemplate
              ? isEditedTemplateDirty
                ? "Unsaved changes"
                : "All changes saved"
              : "New template"}
          </span>
          {issues.length
            ? <span className="template-footer-problems"> · {issues.length} problem{issues.length === 1 ? "" : "s"}</span>
            : <span className="template-footer-ready"> · Ready to save</span>}
        </span>
        <span className="template-footer-actions">
          {/* One entry point: it opens on Explain issues while the draft has problems, otherwise on Propose edits. */}
          <button type="button" className="secondary template-assistant-button" aria-expanded={Boolean(assistant?.isOpen)}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess} onClick={() => { if (!assistant?.isOpen) onOpenAssistant(); }}>
            <AssistantIcon />
            Assistant
            {issues.length ? <span className="template-assistant-count">{issues.length}</span> : null}
          </button>
        </span>
      </footer>
    </section>
    <TemplateAssistant assistant={assistant} draft={draft} issues={issues} isEditing={isEditingTemplate} isDirty={isEditedTemplateDirty} />
    </div>
  );
}

function AssistantIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square">
      <path d="M4 5h16v11H9l-5 4Z" />
      <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" />
    </svg>
  );
}
