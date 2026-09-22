import React, { useRef } from "react";

export function DocumentUploadModal({
  isOpen,
  templates,
  selectedTemplateId,
  sourceFiles,
  isDragActive,
  isUploadingDocuments,
  hasApiAccess,
  onClose,
  onSelectTemplate,
  onSelectSourceFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveSourceFile,
  onSubmit,
}) {
  const uploadInputRef = useRef(null);

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
          <label data-tour="upload-files">
            Source files
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="upload-input-hidden"
              multiple
              onChange={(event) => {
                onSelectSourceFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className={
                isDragActive ? "upload-dropzone is-active" : "upload-dropzone"
              }
              onClick={() => uploadInputRef.current?.click()}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <strong>Drag and drop source files here</strong>
              <span>or click to browse Documents (PNG, JPG, WEBP, PDF)</span>
              <em>
                {sourceFiles.length
                  ? `${sourceFiles.length} Source file${sourceFiles.length === 1 ? "" : "s"} selected`
                  : "No Source files selected"}
              </em>
            </button>
            {sourceFiles.length ? (
              <div className="upload-file-list" role="list">
                {sourceFiles.map((entry) => (
                  <div className="upload-file-row" role="listitem" key={entry.id}>
                    <span className="upload-file-name" title={entry.file.name}>
                      {entry.file.name}
                    </span>
                    <div className="upload-file-actions">
                      <span
                        className={`status-pill ${queueStatusTone(entry.queueStatus)}`}
                      >
                        {formatQueueStatus(entry.queueStatus)}
                      </span>
                      {entry.queueStatus === "pending" ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={isUploadingDocuments}
                          onClick={() => onRemoveSourceFile(entry.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {entry.queueError ? (
                      <p className="hint upload-file-error">{entry.queueError}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </label>
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

function queueStatusTone(status) {
  if (status === "success") return "good";
  if (status === "failed") return "bad";
  return "pending";
}

function formatQueueStatus(status) {
  const normalizedStatus = String(status || "").trim();
  if (!normalizedStatus) {
    return "";
  }
  return `${normalizedStatus.charAt(0).toUpperCase()}${normalizedStatus.slice(1)}`;
}
