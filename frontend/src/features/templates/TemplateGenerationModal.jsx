import React, { useEffect, useRef, useState } from "react";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ModalHeader } from "../layout/ModalDialog.jsx";

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
  const dialog = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadError, setUploadError] = useState("");
  useEffect(() => {
    if (!isOpen) return;
    setIsDragActive(false);
    setUploadError("");
    const previous = document.activeElement;
    dialog.current?.querySelector(".upload-dropzone")?.focus();

    return () => previous?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  function selectFiles(files) {
    if (files.length > 1) {
      setUploadError("Choose one sample document at a time.");

      return;
    }

    setUploadError("");

    if (files[0]) onFileChange(files[0]);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }

    if (event.key !== "Tab") return;

    const controls = [
      ...dialog.current.querySelectorAll(
        'input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), button:not(:disabled)',
      ),
    ];

    const first = controls[0];
    const last = controls.at(-1);

    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="modal-card template-generation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-generation-title"
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
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
              isDragActive={isDragActive}
              maxSourceFileBytes={maxSourceFileBytes}
              onSelectSourceFiles={selectFiles}
              onDragOver={() => setIsDragActive(true)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsDragActive(false);
              }}
              onDrop={(event) => {
                setIsDragActive(false);
                selectFiles(Array.from(event.dataTransfer?.files || []));
              }}
              onRemoveSourceFile={() => {
                setUploadError("");
                onFileChange(null);
              }}
            />
            <label>
              What should this template capture? (optional)
              <textarea
                rows={3}
                maxLength={8192}
                value={instructions}
                placeholder="For example, supplier details and line items, excluding payment information."
                onChange={(event) => onInstructionsChange(event.target.value)}
              />
            </label>
            {hasUnsavedChanges && (
              <label className="template-generation-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => onConfirmedChange(event.target.checked)}
                />
                <span>
                  I understand that successful generation will replace my unsaved name, description, and fields.
                </span>
              </label>
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
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={isGenerating || !hasApiAccess || !file || (hasUnsavedChanges && !confirmed)}
            onClick={onGenerate}
          >
            {isGenerating ? "Generating…" : error ? "Try again" : "Generate template"}
          </button>
        </div>
      </div>
    </div>
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
