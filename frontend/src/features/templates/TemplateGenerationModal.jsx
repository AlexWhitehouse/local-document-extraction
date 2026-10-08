import React, { useEffect, useState } from "react";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { Button } from "../ui/Button.jsx";
import { CheckboxField, Field, Textarea } from "../ui/Field.jsx";

export function TemplateGenerationModal({
  isOpen,
  file,
  instructions,
  confirmed,
  isGenerating,
  error,
  hasUnsavedChanges,
  hasApiAccess,
  maxSourceFileBytes,
  onFileChange,
  onInstructionsChange,
  onConfirmedChange,
  onClose,
  onGenerate,
}) {
  const [uploadError, setUploadError] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    setUploadError("");
  }, [isOpen]);

  if (!isOpen) return null;

  // The sample and instructions are a draft, so closing asks first.
  const isDirty = Boolean(file) || Boolean(instructions?.trim());

  const requestClose = async () => {
    if (!isDirty || (await confirmDialog({ ...DISCARD_CHANGES }))) onClose();
  };

  function selectFiles(files) {
    if (files.length > 1) {
      setUploadError("Choose one sample document at a time.");

      return;
    }

    setUploadError("");

    if (files[0]) onFileChange(files[0]);
  }

  return (
    <ModalDialog
      labelledBy="template-generation-title"
      className="template-generation-modal"
      initialFocus=".ui-dropzone-browse"
      isDirty={isDirty}
      onClose={onClose}
    >
        <ModalHeader
          title="Auto generate template"
          titleId="template-generation-title"
          description="Upload a sample for this workspace’s model to propose a template. Review and edit it before saving."
          onClose={onClose}
        />
        {!isGenerating && (
          <>
            <DocumentUploadPanel
              label="Sample file"
              multiple={false}
              sourceFiles={file ? [{ id: "sample", file, queueStatus: "pending" }] : []}
              maxSourceFileBytes={maxSourceFileBytes}
              onSelectSourceFiles={selectFiles}
              onRemoveSourceFile={() => {
                setUploadError("");
                onFileChange(null);
              }}
            />
            <Field label="What should this template capture?" hint="Optional. Leave blank to infer fields from the sample.">
              <Textarea
                rows={3}
                maxLength={8192}
                value={instructions}
                placeholder="e.g. Supplier details and line items, excluding payment information."
                onChange={(event) => onInstructionsChange(event.target.value)}
              />
            </Field>
            {hasUnsavedChanges && (
              <CheckboxField
                label="I understand that successful generation will replace my unsaved name, description, and fields."
                checked={confirmed}
                onChange={onConfirmedChange}
              />
            )}
          </>
        )}
        {isGenerating && <GenerationProgress />}
        {(uploadError || error) && (
          <p className="form-error" role="alert">
            {uploadError || error}
          </p>
        )}
        <div className="actions">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isGenerating || !hasApiAccess || !file || (hasUnsavedChanges && !confirmed)}
            onClick={onGenerate}
          >
            {isGenerating ? "Generating…" : error ? "Try again" : "Generate template"}
          </Button>
        </div>
    </ModalDialog>
  );
}

const GENERATION_PHRASES = [
  "Combobulating response…",
  "Consulting the schema sprites…",
  "Untangling the JSON spaghetti…",
  "Teaching columns to line up…",
  "Polishing the curly brackets…",
  "Asking the pixels politely…",
  "Putting the data ducks in a row…",
  "Applying a little template magic…",
];

function GenerationProgress() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseIndex((current) => (current + 1) % GENERATION_PHRASES.length);
    }, 2800);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="template-generation-progress"
      role="status"
      aria-label="Generating template. You can cancel at any time."
    >
      <span className="template-generation-spinner" aria-hidden="true" />
      <div aria-hidden="true">
        <strong>{GENERATION_PHRASES[phraseIndex]}</strong>
        <p>Working on your template. You can cancel at any time.</p>
      </div>
    </div>
  );
}
