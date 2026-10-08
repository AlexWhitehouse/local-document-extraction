import React, { useId } from "react";
import { CheckIcon, CloseIcon, CopyIcon } from "../layout/Icons.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { Field, Textarea } from "../ui/Field.jsx";

const PROPERTY_LABELS = {
  name: "Name",
  description: "Description",
  data_type: "Type",
  fields: "Fields",
  object_schema: "Table columns",
  heading: "Column name",
};

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
          <h2 id={titleId}>Export or import JSON</h2>
        </div>
        <div className="modal-head-actions">
          <IconButton label="Copy template JSON" icon={copied ? CheckIcon : CopyIcon} onClick={onCopy} />
          <IconButton label="Close" icon={CloseIcon} disabled={isSavingTemplate} onClick={requestClose} />
        </div>
      </div>
      <Field
        label="Template JSON"
        className="template-json-label"
        error={error}
      >
        <Textarea
          className="template-json-textarea"
          spellCheck="false"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      </Field>
      {diagnostics.length > 0 && <ul className="template-json-diagnostics">{diagnostics.map(issue => <li key={issue.id}>
        <strong>{issue.location.scope === "template" ? "Template" : `Field ${issue.location.fieldIndex + 1}${issue.location.scope === "column" ? `, column ${issue.location.columnIndex + 1}` : ""}`} · {PROPERTY_LABELS[issue.location.property] || issue.location.property}: {issue.title}.</strong> {issue.explanation} {issue.remedy}
      </li>)}</ul>}
      <div className="template-json-modal-footer">
        <div className="actions">
          <Button
            type="button"
            variant="secondary"
            disabled={isSavingTemplate}
            onClick={requestClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSavingTemplate || !hasApiAccess}
            onClick={onSave}
          >
            {isSavingTemplate ? "Saving…" : "Save JSON"}
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}
