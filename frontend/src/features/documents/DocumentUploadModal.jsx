import React from "react";
import { DocumentUploadPanel } from "./DocumentUploadPanel.jsx";

export function DocumentUploadModal({
  isOpen,
  templates,
  selectedTemplateId,
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
        <div className="workspace-head">
          <h2>Upload Document</h2>
          <p>
            Select a template and source files, then queue Document extraction.
          </p>
        </div>
        <div className="row">
          <label>
            Template
            <select
              data-tour="upload-template"
              value={selectedTemplateId}
              onChange={(event) => onSelectTemplate(event.target.value)}
            >
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
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
            disabled={isUploadingDocuments || !hasApiAccess}
            onClick={onSubmit}
          >
            {isUploadingDocuments ? "Uploading..." : "Upload Documents"}
          </button>
        </div>
      </div>
    </div>
  );
}
