import React from "react";
import { TemplateFieldEditor } from "./TemplateFieldEditor.jsx";

export function TemplatePage({
  templateName,
  templateDescription,
  templateFields,
  isEditingTemplate,
  isSavingTemplate,
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
      disabled={
        isSavingTemplate ||
        !hasApiAccess ||
        (isEditingTemplate && !isEditedTemplateDirty)
      }
      onClick={onSaveTemplate}
    >
      {isSavingTemplate
        ? "Saving..."
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
            value={templateName}
            disabled={isSavingTemplate || !hasApiAccess}
            onChange={(event) => onTemplateNameChange(event.target.value)}
          />
        </label>
        <label>
          Description
          <input
            value={templateDescription}
            disabled={isSavingTemplate || !hasApiAccess}
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
        disabled={isSavingTemplate || !hasApiAccess}
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
        <button
          type="button"
          className="studio-text-button"
          disabled={isSavingTemplate || !hasApiAccess}
          onClick={onOpenJsonModal}
        >
          View JSON
        </button>
      </footer>
    </section>
  );
}
