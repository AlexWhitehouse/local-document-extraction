import React, { useRef, useState } from "react";
import { DocumentUploadPanel } from "../../documents/DocumentUploadPanel.jsx";
import "../../documents/DocumentProcessing.css";
import { validateSourceFiles } from "../../documents/sourceFileValidation.js";
import { Button } from "../../ui/Button.jsx";
import { Callout } from "../../ui/Callout.jsx";
import { Field, Select } from "../../ui/Field.jsx";
import { useAsyncAction } from "../../ui/useAsyncAction.js";
import { pluralize } from "../../../lib/text.js";
import { FlowStep } from "./flowParts.jsx";
import { useFinish, useFlowBack } from "./useFlowBack.js";

const AUTOMATIC = "automatic";

const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

// Automatic selection matches each document to one of the templates that carry a tag.
function automaticTags(templates) {
  return [...new Set(templates.flatMap((template) => template.tags ?? []))].sort();
}

/** Upload documents: pick files and a template, then queue them through the documents upload pipeline. */
export function UploadFlow({ interpretation, context, onFinish, onBack, registerBack }) {
  const templates = context.catalog?.templates ?? [];
  const tags = automaticTags(context.templateController?.templates ?? []);
  const maxSourceFileBytes = context.documentController?.uploadModal?.maxSourceFileBytes;
  const requested = interpretation?.args?.template_id;
  // Until you choose, the default follows the catalogue, which may still be loading when the flow opens.
  const [chosenTemplateId, setTemplateId] = useState(null);
  const templateId = chosenTemplateId ?? (requested || (tags.length ? AUTOMATIC : templates[0]?.id || ""));
  const finish = useFinish(onFinish);
  const [entries, setEntries] = useState([]);
  const [rejections, setRejections] = useState([]);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const waiting = entries.filter((entry) => entry.queueStatus !== "success");

  const addFiles = (files) => {
    const { accepted, rejections: refused } = validateSourceFiles(files, maxSourceFileBytes);
    setRejections(refused);
    setError("");
    const known = new Set(entries.map((entry) => fileKey(entry.file)));
    const additions = [];

    for (const file of accepted) {
      if (known.has(fileKey(file))) continue;
      known.add(fileKey(file));
      additions.push({ id: `palette-upload-${++sequence.current}`, file, queueStatus: "pending", queueError: "" });
    }

    setEntries([...entries, ...additions]);
  };

  const [uploading, upload] = useAsyncAction(async () => {
    setError("");
    const automatic = templateId === AUTOMATIC;

    // Files already queued by an earlier partial attempt are not sent again.
    const outcome = await context.documentController.actions.uploadEntries({
      entries: waiting,
      templateId: automatic ? "" : templateId,
      templateTags: automatic ? tags : undefined,
      onProgress: (id, queueStatus, queueError) =>
        setEntries((rows) => rows.map((row) => (row.id === id ? { ...row, queueStatus, queueError } : row))),
    });

    if (!outcome) {
      setError("Another upload is still running. Try again when it finishes.");

      return;
    }

    if (outcome.interrupted) {
      setError("The upload stopped before it finished. Check the documents list before trying again.");

      return;
    }

    // The upload toast has reported the outcome; failed rows stay listed with their reasons.
    if (outcome.failed === 0) finish();
  });

  // Esc can't leave while files are uploading.
  useFlowBack(registerBack, () => uploading);

  if (!context.modelReady)
    return (
      <FlowStep
        title="Upload documents"
        actions={
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        }
      >
        <Callout tone="info">Uploads need a Model gateway. Set one up on the Workspaces page.</Callout>
      </FlowStep>
    );

  const automaticCount = (context.templateController?.templates ?? []).filter((template) => template.tags?.length).length;

  return (
    <FlowStep
      title="Upload documents"
      actions={
        <>
          <Button variant="secondary" disabled={uploading} onClick={onBack}>
            Cancel
          </Button>
          <Button
            pending={uploading}
            pendingLabel="Uploading…"
            disabled={!waiting.length || !templateId}
            onClick={() => void upload()}
          >
            {waiting.length ? `Upload ${pluralize(waiting.length, "document")}` : "Upload"}
          </Button>
        </>
      }
    >
      <DocumentUploadPanel
        sourceFiles={entries}
        rejections={rejections}
        disabled={uploading}
        maxSourceFileBytes={maxSourceFileBytes}
        onSelectSourceFiles={addFiles}
        onRemoveSourceFile={(id) => setEntries(entries.filter((entry) => entry.id !== id))}
      />
      <Field
        label="Template"
        hint={
          templateId === AUTOMATIC
            ? `Each document is matched to one of the ${pluralize(automaticCount, "tagged template")}.`
            : templateId
              ? undefined
              : context.catalog
                ? "Create a template before uploading."
                : "Loading templates…"
        }
      >
        <Select value={templateId} disabled={uploading} onChange={(event) => setTemplateId(event.target.value)}>
          {tags.length ? <option value={AUTOMATIC}>Choose automatically</option> : null}
          {templateId ? null : <option value="">{context.catalog ? "No templates yet" : "Loading…"}</option>}
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} v{template.current_version}
            </option>
          ))}
        </Select>
      </Field>
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
    </FlowStep>
  );
}
