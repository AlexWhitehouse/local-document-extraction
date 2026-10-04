import React, { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";

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
      if (!controller.signal.aborted) setError(failure.message);
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
        <button type="button" className="modal-close" aria-label="Close" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {!templates.length && <p>Create a Template in Templates first, then choose its version here.</p>}
      <label>
        Template
        <select
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
        </select>
      </label>
      <label>
        Field version
        <select
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
        </select>
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!template || loading} onClick={select}>
          {loading ? "Loading…" : action}
        </button>
      </div>
    </ModalDialog>
  );
}
