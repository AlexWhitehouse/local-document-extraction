import React, { useId } from "react";
import { CopyIcon } from "../layout/Icons.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function TemplateJsonModal({
  isOpen,
  isDirty = false,
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
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  // Cancel is a close too, so it asks before discarding a dirty draft like Escape does.
  const requestClose = async () => {
    if (!isDirty || (await confirmDialog({ ...DISCARD_CHANGES }))) onClose();
  };

  return (
    <ModalDialog
      labelledBy={titleId}
      className="template-json-modal"
      isDirty={isDirty}
      closeDisabled={isSavingTemplate}
      onClose={onClose}
    >
      <div className="template-json-modal-head">
        <div>
          <h2 id={titleId}>Export / Import Template</h2>
          <p>Review, copy, or edit the template configuration.</p>
        </div>
        <div className="modal-head-actions">
          <button
            type="button"
            className="icon-action-button template-json-copy-button"
            aria-label="Copy template JSON"
            title="Copy JSON"
            onClick={onCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            title="Close"
            disabled={isSavingTemplate}
            onClick={requestClose}
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
        ) : (
          <p className="hint">Changes are validated and applied when you save.</p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={isSavingTemplate}
            onClick={requestClose}
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
    </ModalDialog>
  );
}
