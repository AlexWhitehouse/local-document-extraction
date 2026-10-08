import React, { useId } from "react";
import "./DocumentProcessing.css";
import { DocumentUploadPanel } from "./DocumentUploadPanel.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { ModalDialog, ModalFooter, ModalHeader } from "../layout/ModalDialog.jsx";
import { Button } from "../ui/Button.jsx";
import { Field, Select } from "../ui/Field.jsx";

export function DocumentUploadModal({
  isOpen,
  templates,
  selectedTemplateId,
  selectedTags = [],
  availableTags = [],
  onSelectTags,
  sourceFiles,
  uploadRejections = [],
  isUploadingDocuments,
  hasApiAccess,
  maxSourceFileBytes = 10 * 1024 * 1024,
  onClose,
  onSelectTemplate,
  onSelectSourceFiles,
  onRemoveSourceFile,
  onSubmit,
}) {
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  // Only files still waiting to be uploaded count as unsaved. Queued and failed rows do not.
  const isDirty = !isUploadingDocuments && sourceFiles.some((entry) => entry.queueStatus === "pending");
  const hintId = `${titleId}-submit-hint`;
  // The hint names what is missing; a template chosen without tags is explained by the tag picker.
  const submitBlocked = !isUploadingDocuments && (!selectedTemplateId || !sourceFiles.length);

  // Cancel asks before discarding picked files; the upload itself is never aborted.
  async function requestClose() {
    if (!isDirty || (await confirmDialog(DISCARD_CHANGES))) onClose();
  }

  return (
    <ModalDialog labelledBy={titleId} isDirty={isDirty} onClose={onClose}>
      <ModalHeader
        titleId={titleId}
        title="Upload documents"
        description="Choose a template, then add files."
        onClose={onClose}
      />
      <div className="row">
        <Field label="Template">
          <Select
            data-tour="upload-template"
            value={selectedTemplateId}
            onChange={(event) => onSelectTemplate(event.target.value)}
          >
            <option value="">Select template</option>
            <option value="automatic">Automatic (by tags)</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
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
          rejections={uploadRejections}
          disabled={isUploadingDocuments}
          maxSourceFileBytes={maxSourceFileBytes}
          onSelectSourceFiles={onSelectSourceFiles}
          onRemoveSourceFile={onRemoveSourceFile}
          tourTarget="upload-files"
        />
      </div>
      <ModalFooter>
        {submitBlocked ? (
          <p className="hint upload-submit-hint" id={hintId}>
            Choose a template and at least one file
          </p>
        ) : null}
        <Button variant="secondary" onClick={requestClose}>
          Cancel
        </Button>
        <Button
          data-tour="upload-submit"
          aria-describedby={submitBlocked ? hintId : undefined}
          disabled={
            !hasApiAccess ||
            submitBlocked ||
            (selectedTemplateId === "automatic" && !selectedTags.length)
          }
          pending={isUploadingDocuments}
          pendingLabel="Uploading…"
          onClick={onSubmit}
        >
          Upload documents
        </Button>
      </ModalFooter>
    </ModalDialog>
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
            <Button variant="text" onClick={() => onChange([])}>
              Clear
            </Button>
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
          "Choose at least one tag to match each document to a template."
        )}
      </p>
    </fieldset>
  );
}
