import { useCallback, useEffect, useRef, useState } from "react";
import { validateTemplateJsonPayload } from "./templateFields.js";
import { describeError } from "../../lib/describeError";
import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";

export function useTemplateGeneration({
  request,
  workspaceId,
  sessionId,
  activePage,
  templateId,
  hasApiAccess,
  maxSourceFileBytes = 10 * 1024 * 1024,
  hasUnsavedChanges,
  onApply,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [createNew, setCreateNew] = useState(false);
  const [file, setFile] = useState(null);
  const [instructions, setInstructions] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const scope = JSON.stringify([workspaceId, sessionId, activePage, templateId, hasApiAccess]);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setIsGenerating(false);
    setIsOpen(false);
    setFile(null);
    setInstructions("");
    setConfirmed(false);
    setError("");
  }, []);

  useEffect(() => {
    cancel();

    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [scope, cancel]);

  function open({ createNew = false } = {}) {
    cancel();
    setCreateNew(createNew);
    setIsOpen(true);
  }

  async function generate() {
    if (pending.current || !isOpen || !hasApiAccess) return;

    if (!file) {
      setError("Select a sample file.");

      return;
    }

    if (!SOURCE_FILE_MIME_TYPES.includes(file.type)) {
      setError("Choose a PDF, PNG, JPEG, or WebP file.");

      return;
    }

    if (!file.size || file.size > maxSourceFileBytes) {
      setError(`Choose a nonempty file no larger than ${maxSourceFileBytes / (1024 * 1024)} MiB.`);

      return;
    }

    if (new TextEncoder().encode(instructions).length > 8192) {
      setError("Instructions must be at most 8 KiB. Please shorten them.");

      return;
    }

    if (hasUnsavedChanges && !confirmed) {
      setError("Confirm replacement of your unsaved edits before generating.");

      return;
    }

    const controller = new AbortController();
    pending.current = controller;

    const isCurrent = () =>
      pending.current === controller && !controller.signal.aborted && currentScope.current === scope;

    setIsGenerating(true);
    setError("");

    try {
      const body = new FormData();
      body.append("document", file);
      body.append("instructions", instructions);

      const response = await request("/templates/generate", {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!isCurrent()) return;
      const payload = validateTemplateJsonPayload(response, { includeObjectSchema: true });
      onApply(payload, { createNew });
      cancel();
    } catch (failure) {
      if (isCurrent()) setError(describeError(failure, "Template generation failed. Try again."));
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setIsGenerating(false);
      }
    }
  }

  return {
    open,
    cancel,
    modal: {
      isOpen,
      file,
      instructions,
      confirmed,
      isGenerating,
      error,
      hasUnsavedChanges,
      hasApiAccess,
      maxSourceFileBytes,
      onFileChange: (value) => {
        setFile(value);
        setError("");
      },
      onInstructionsChange: setInstructions,
      onConfirmedChange: setConfirmed,
      onClose: cancel,
      onGenerate: generate,
    },
  };
}
