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
  processingPolicy,
  onSelectTags,
  onPageSelectionChange,
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
            <fieldset className="upload-tag-selector">
              <legend>Template tags</legend>
              <p className="hint">Choose at least one tag. Each document is matched to a suitable template carrying any selected tag.</p>
              {availableTags.length ? availableTags.map((tag) => (
                <label key={tag}>
                  <input type="checkbox" checked={selectedTags.includes(tag)} disabled={isUploadingDocuments}
                    onChange={(event) => onSelectTags(event.target.checked ? [...selectedTags, tag] : selectedTags.filter((value) => value !== tag))} />
                  {tag}
                </label>
              )) : <p>No tags are available. Create and associate tags on the Templates page.</p>}
            </fieldset>
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
            onPageSelectionChange={onPageSelectionChange}
            tourTarget="upload-files"
          />
        </div>
        {processingPolicy ? <p className="hint upload-processing-policy">
          Workspace policy: {processingPolicy.enable_smart_splitting ? "Smart splitting enabled" : "Smart splitting disabled"}.
          {processingPolicy.enable_smart_splitting ? processingPolicy.exclude_blank_pages ? " Verified blank pages are excluded." : " Blank pages are retained." : " Each file is processed as one document."}
        </p> : null}
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-tour="upload-submit"
            disabled={isUploadingDocuments || !hasApiAccess || !sourceFiles.length || !selectedTemplateId || (selectedTemplateId === "automatic" && !selectedTags.length)}
            onClick={onSubmit}
          >
            {isUploadingDocuments ? "Uploading…" : "Upload Documents"}
          </button>
        </div>
      </div>
    </div>
  );
}
