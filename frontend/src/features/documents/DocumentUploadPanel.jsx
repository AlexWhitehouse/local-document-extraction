import React, { useId, useRef } from "react";
import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";
import { formatUploadLimit } from "./sourceFileValidation.js";
import { pluralize } from "../../lib/text";
import { Button } from "../ui/Button.jsx";

export function DocumentUploadPanel({
  label = "Source files",
  multiple = true,
  sourceFiles = [],
  rejections = [],
  isDragActive = false,
  disabled = false,
  maxSourceFileBytes = 10 * 1024 * 1024,
  onSelectSourceFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  onRemoveSourceFile,
  tourTarget,
}) {
  const uploadInputRef = useRef(null);
  const inputId = useId();
  const showDropzone = multiple || sourceFiles.length === 0;

  return (
    <div className="document-upload-panel" data-tour={tourTarget}>
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={uploadInputRef}
        id={inputId}
        tabIndex={-1}
        disabled={disabled || !showDropzone}
        type="file"
        accept={SOURCE_FILE_MIME_TYPES.join(",")}
        className="upload-input-hidden"
        multiple={multiple}
        onChange={(event) => {
          onSelectSourceFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      {showDropzone && (
        <button
          type="button"
          disabled={disabled}
          className={isDragActive ? "upload-dropzone is-active" : "upload-dropzone"}
          onClick={() => uploadInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();

            if (!disabled) onDragOver?.(event);
          }}
          onDragLeave={(event) => {
            event.preventDefault();

            if (!disabled) onDragLeave?.(event);
          }}
          onDrop={(event) => {
            event.preventDefault();

            if (!disabled) onDrop?.(event);
          }}
        >
          <strong>{multiple ? "Drop files or click to browse" : "Drop a sample document or click to browse"}</strong>
          <span>PDF, PNG, JPG or WEBP · up to {formatUploadLimit(maxSourceFileBytes)}</span>
          {sourceFiles.length ? <em>{pluralize(sourceFiles.length, "file")} selected</em> : null}
        </button>
      )}
      {rejections.length ? (
        <ul className="upload-rejections" role="alert">
          {rejections.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      {sourceFiles.length ? (
        <div className="upload-file-list" role="list">
          {sourceFiles.map((entry) => (
            <div className="upload-file-row" role="listitem" key={entry.id}>
              <span className="upload-file-name" title={entry.file.name}>
                {entry.file.name}
              </span>
              <div className="upload-file-actions">
                <span className={`status-pill ${queueStatusTone(entry.queueStatus)}`}>
                  {formatQueueStatus(entry.queueStatus)}
                </span>
                {entry.queueStatus === "pending" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={`Remove ${entry.file.name}`}
                    onClick={() => onRemoveSourceFile(entry.id)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              {entry.queueError ? <p className="hint upload-file-error">{entry.queueError}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function queueStatusTone(status) {
  if (status === "success") return "good";

  if (status === "failed") return "bad";

  return "pending";
}

function formatQueueStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
