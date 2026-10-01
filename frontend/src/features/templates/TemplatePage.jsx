import React from "react";
import { MagicIcon } from "./MagicIcon.jsx";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";

export function TemplatePage({
  templateName,
  templateDescription,
  templateFields,
  isEditingTemplate,
  isSavingTemplate,
  isGeneratingTemplate = false,
  onAutoGenerate,
  isEditedTemplateDirty,
  hasApiAccess,
  onTemplateNameChange,
  onTemplateDescriptionChange,
  onTemplateFieldsChange,
  onOpenJsonModal,
  onSaveTemplate,
}) {
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
    <section className="studio-template-page" aria-label="Template editor">
      <div className="studio-template-meta">
        <label>
          Template name
          <input
            data-tour="template-name"
            value={templateName}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
            onChange={(event) => onTemplateNameChange(event.target.value)}
          />
        </label>
        <label>
          Description
          <input
            value={templateDescription}
            disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess}
            onChange={(event) =>
              onTemplateDescriptionChange(event.target.value)
            }
          />
        </label>
      </div>
      <TemplateFieldEditor
        fields={templateFields}
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
          {templateFields.length} fields ·{" "}
          {isEditingTemplate
            ? isEditedTemplateDirty
              ? "Unsaved changes"
              : "All changes saved"
            : "New template"}
        </span>
        <button type="button" className="studio-generate-button"
          disabled={isSavingTemplate || isGeneratingTemplate || !hasApiAccess} onClick={onAutoGenerate}>
          <MagicIcon />
          Auto generate
        </button>
      </footer>
    </section>
  );
}
