import React, { useEffect, useState } from "react";
import { parsePageSelection } from "./documentProcessing.js";

export function UploadPageSelection({ entry, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => {
    if (!open) return undefined;
    const objectUrl = URL.createObjectURL(entry.file);
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); setUrl(""); };
  }, [open, entry.file]);
  let error = "";
  try { parsePageSelection(entry.pageSelection); } catch (problem) { error = problem.message; }
  return (
    <div className="upload-page-selection">
      <button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Hide page preview" : "Preview and select pages"}
      </button>
      <label>
        Pages from {entry.file.name}
        <input value={entry.pageSelection || ""} disabled={disabled} placeholder="All pages, or 1, 3-5" aria-invalid={Boolean(error)}
          onChange={(event) => onChange(entry.id, event.target.value)} />
      </label>
      {error ? <p className="upload-file-error" role="alert">{error}</p> : null}
      {open ? (
        <div className="upload-pdf-preview">
          <label>Preview page<input type="number" min="1" value={previewPage} onChange={(event) => setPreviewPage(Math.max(1, Number(event.target.value) || 1))} /></label>
          {url ? <iframe title={`Page preview of ${entry.file.name}`} src={`${url}#page=${previewPage}&view=FitH`} /> : null}
          <p className="hint">Numbers refer to the original PDF. Leave Pages empty to include every page.</p>
        </div>
      ) : null}
    </div>
  );
}
