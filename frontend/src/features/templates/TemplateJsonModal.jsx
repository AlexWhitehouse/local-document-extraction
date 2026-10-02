import React from "react";
import { CopyIcon } from "../layout/Icons.jsx";

export function TemplateJsonModal({
  isOpen,
  draft,
  error,
  diagnostics = [],
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
        <div className="template-json-modal-head">
          <div>
            <h2>Export / Import Template</h2>
            <p>
              Review, copy, or edit the template configuration.
            </p>
          </div>
          <div className="modal-head-actions">
            <button
              type="button"
              className="icon-action-button template-json-copy-button"
              aria-label="Copy template JSON"
              title={copied ? "Copied" : "Copy JSON"}
              onClick={onCopy}
            >
              <CopyIcon />
            </button>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              title="Close"
              disabled={isSavingTemplate}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <label className="template-json-label">
          <span>Template JSON</span>
          <textarea
            className="template-json-textarea"
            aria-invalid={Boolean(error)}
            aria-describedby="template-json-validation"
            spellCheck="false"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </label>
        {diagnostics.length > 0 && <ul className="template-json-diagnostics">{diagnostics.map(issue => <li key={issue.id}>
          <strong>{issue.location.scope === "template" ? "Template" : `Field ${issue.location.fieldIndex + 1}${issue.location.scope === "column" ? `, column ${issue.location.columnIndex + 1}` : ""}`} · {issue.location.property}: {issue.title}.</strong> {issue.explanation} {issue.remedy}
        </li>)}</ul>}
        <div className="template-json-modal-footer">
          {error ? (
            <p id="template-json-validation" className="form-error" role="alert">{error}</p>
          ) : copied ? (
            <p className="hint" role="status">Copied JSON to clipboard.</p>
          ) : (
            <p className="hint">Changes are validated and applied when you save.</p>
          )}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={isSavingTemplate}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSavingTemplate || !hasApiAccess}
              onClick={onSave}
            >
              {isSavingTemplate ? "Saving…" : "Save Template JSON"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
