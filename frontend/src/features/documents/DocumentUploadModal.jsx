import React from "react";
import "./DocumentProcessing.css";
import { DocumentUploadPanel } from "./DocumentUploadPanel.jsx";
import { ModalHeader } from "../layout/ModalDialog.jsx";

export function DocumentUploadModal({
  isOpen,
  templates,
  selectedTemplateId,
  selectedTags = [],
  availableTags = [],
  onSelectTags,
  sourceFiles,
  isDragActive,
  isUploadingDocuments,
  hasApiAccess,
  maxSourceFileBytes = 10 * 1024 * 1024,
  onClose,
  onSelectTemplate,
  onSelectSourceFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveSourceFile,
  onSubmit,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Upload document"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalHeader
          title="Upload Document"
          description="Choose a template or tags for automatic selection, then add your source files."
          onClose={onClose}
        />
        <div className="row">
          <label>
            Template
            <select
              data-tour="upload-template"
              value={selectedTemplateId}
              onChange={(event) => onSelectTemplate(event.target.value)}
            >
              <option value="">Select template</option>
              <option value="automatic">Automatic — select by tags</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplateId === "automatic" ? (
            <UploadTagPicker
              tags={availableTags}
              templates={templates}
              selectedTags={selectedTags}
              disabled={isUploadingDocuments}
              onChange={onSelectTags}
            />
          ) : null}
          <DocumentUploadPanel
            sourceFiles={sourceFiles}
            isDragActive={isDragActive}
            disabled={isUploadingDocuments}
            maxSourceFileBytes={maxSourceFileBytes}
            onSelectSourceFiles={onSelectSourceFiles}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onRemoveSourceFile={onRemoveSourceFile}
            tourTarget="upload-files"
          />
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-tour="upload-submit"
            disabled={
              isUploadingDocuments ||
              !hasApiAccess ||
              !sourceFiles.length ||
              !selectedTemplateId ||
              (selectedTemplateId === "automatic" && !selectedTags.length)
            }
            onClick={onSubmit}
          >
            {isUploadingDocuments ? "Uploading…" : "Upload Documents"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Toggle chips for the tags that steer automatic template selection. */
function UploadTagPicker({ tags, templates, selectedTags, disabled, onChange }) {
  const templatesWithTag = (tag) => templates.filter((template) => template.tags?.includes(tag));
  const candidates = templates.filter((template) => template.tags?.some((tag) => selectedTags.includes(tag)));

  return (
    <fieldset className="upload-tag-picker" disabled={disabled}>
      <legend className="upload-tag-picker-head">
        <span>Template tags</span>
        {selectedTags.length ? (
          <span className="upload-tag-picker-count">
            {selectedTags.length} selected
            <button type="button" className="studio-text-button" onClick={() => onChange([])}>
              Clear
            </button>
          </span>
        ) : null}
      </legend>
      {tags.length ? (
        <div className="upload-tag-options">
          {tags.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            const count = templatesWithTag(tag).length;

            return (
              <label
                key={tag}
                className={`upload-tag-option${isSelected ? " selected" : ""}`}
                title={`${count} ${count === 1 ? "template" : "templates"} tagged ${tag}`}
              >
                <input
                  type="checkbox"
                  aria-label={tag}
                  checked={isSelected}
                  onChange={(event) =>
                    onChange(
                      event.target.checked ? [...selectedTags, tag] : selectedTags.filter((value) => value !== tag),
                    )
                  }
                />
                <span className="upload-tag-option-name">{tag}</span>
                <span className="upload-tag-option-count">{count}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="upload-tag-picker-note">No tags yet. Add tags to templates on the Templates page.</p>
      )}
      <p className="upload-tag-picker-note">
        {selectedTags.length ? (
          candidates.length ? (
            <>
              Each document is matched to one of{" "}
              <strong>
                {candidates.length} {candidates.length === 1 ? "template" : "templates"}
              </strong>
              : {candidates.map((template) => template.name).join(", ")}
            </>
          ) : (
            "No templates carry the selected tags."
          )
        ) : (
          "Choose at least one tag. Each document is matched to a template carrying any selected tag."
        )}
      </p>
    </fieldset>
  );
}
