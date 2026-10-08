import React, { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { describeError } from "../../lib/describeError";
import { Button, IconButton } from "../ui/Button.jsx";
import { CloseIcon } from "../layout/Icons.jsx";
import { Field, Select } from "../ui/Field.jsx";

export function TemplateVersionDialog({
  templates,
  source,
  title,
  description,
  action,
  loadTemplate,
  onSelect,
  onClose,
}) {
  const [templateId, setTemplateId] = useState(() => templates.some((t) => t.id === source?.id) ? source.id : "");

  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  const template = templates.find((t) => t.id === templateId);
  useEffect(() => () => request.current?.abort(), []);

  const select = async () => {
    if (!template || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");

    try {
      const selected = await loadTemplate(template.id, version, controller.signal);

      if (controller.signal.aborted) return;
      onSelect(selected);
      onClose();
    } catch (failure) {
      if (!controller.signal.aborted) setError(describeError(failure, "This version couldn’t be loaded. Try again."));
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <ModalDialog label={title} initialFocus="select" onClose={onClose}>
      <div className="evaluation-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={onClose} />
      </div>
      {!templates.length && <p>Create a Template in Templates first, then choose its version here.</p>}
      <Field label="Template">
        <Select
          value={templateId}
          disabled={loading || !templates.length}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setVersion("");
            setError("");
          }}
        >
          <option value="" disabled>
            Choose a Template
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Field version">
        <Select
          value={version}
          disabled={!template || loading}
          onChange={(event) => setVersion(event.target.value)}
        >
          <option value="">
            {template ? `Current · v${template.current_version}` : "Select a Template first"}
          </option>
          {Array.from({ length: Math.max(0, (template?.current_version || 1) - 1) }, (_, index) => (
            <option key={index} value={index + 1}>
              Fields v{index + 1}
            </option>
          ))}
        </Select>
      </Field>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!template || loading} onClick={select}>
          {loading ? "Loading…" : action}
        </Button>
      </div>
    </ModalDialog>
  );
}
