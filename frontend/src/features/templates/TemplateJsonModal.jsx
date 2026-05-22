import React from "react";

export function TemplateJsonModal({
  isOpen,
  draft,
  error,
  copied,
  isSavingTemplate,
  hasApiAccess,
  onDraftChange,
  onSave,
  onClose,
  onCopy,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card template-json-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export or import template JSON"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workspace-head template-json-modal-head">
          <div>
            <h2>Export / Import Template</h2>
            <p>
              Edit the raw JSON payload used by the template API. Saving will
              validate it before updating the template.
            </p>
          </div>
          <button
            type="button"
            className="icon-action-button template-json-copy-button"
            aria-label="Copy template JSON"
            title={copied ? "Copied" : "Copy JSON"}
            onClick={onCopy}
          >
            <CopyIcon />
          </button>
        </div>
        <label className="template-json-label">
          Template JSON
          <textarea
            className="template-json-textarea"
            spellCheck="false"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error">{error}</p>
        ) : copied ? (
          <p className="hint">Copied JSON to clipboard.</p>
        ) : null}
        <div className="actions">
          <button
            type="button"
            disabled={isSavingTemplate || !hasApiAccess}
            onClick={onSave}
          >
            {isSavingTemplate ? "Saving..." : "Save Template JSON"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={isSavingTemplate}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
