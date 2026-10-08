import React from "react";
import { formatUploadLimit } from "./sourceFileValidation.js";
import { pluralize } from "../../lib/text";
import { Button } from "../ui/Button.jsx";
import { Badge } from "../ui/Status.jsx";
import { Dropzone } from "../ui/Dropzone.jsx";
import { statusTone } from "../../lib/status.js";

export function DocumentUploadPanel({
  label = "Source files",
  multiple = true,
  sourceFiles = [],
  rejections = [],
  disabled = false,
  maxSourceFileBytes = 10 * 1024 * 1024,
  onSelectSourceFiles,
  onRemoveSourceFile,
  tourTarget,
}) {
  const showDropzone = multiple || sourceFiles.length === 0;

  return (
    <div className="document-upload-panel" data-tour={tourTarget}>
      <span className="document-upload-label">{label}</span>
      {showDropzone && (
        <Dropzone
          label={label}
          hint={`PDF, PNG, JPG or WEBP · up to ${formatUploadLimit(maxSourceFileBytes)}`}
          multiple={multiple}
          disabled={disabled}
          onFiles={onSelectSourceFiles}
        >
          {sourceFiles.length ? <em>{pluralize(sourceFiles.length, "file")} selected</em> : null}
        </Dropzone>
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
                <Badge tone={statusTone(entry.queueStatus)}>{formatQueueStatus(entry.queueStatus)}</Badge>
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

function formatQueueStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
