import React, { useRef, useState } from "react";
import { ACCEPTED_FILE_TYPES } from "../documents/sourceFileValidation.js";
import "./Dropzone.css";

// File drop target with a hidden input. Owns drag state, click-to-browse and drop. Callers validate in onFiles.
// Children render inside the browse button. renderContent({ browse, dragging }) replaces that button so the
// caller can place its own buttons, as the evaluation drop zone does.
export function Dropzone({
  label,
  hint,
  multiple = true,
  disabled = false,
  accept = ACCEPTED_FILE_TYPES.join(","),
  className,
  onFiles,
  children,
  renderContent,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const browse = () => {
    if (!disabled) inputRef.current?.click();
  };

  const receive = (files) => {
    setDragging(false);

    if (!disabled && files.length) onFiles(files);
  };

  const classes = ["ui-dropzone", dragging && !disabled ? "is-active" : null, className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      onDragOver={(event) => {
        event.preventDefault();

        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        receive(Array.from(event.dataTransfer?.files || []));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        tabIndex={-1}
        aria-label={label}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="ui-dropzone-input"
        onChange={(event) => {
          receive(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      {renderContent ? (
        renderContent({ browse, dragging })
      ) : (
        <button type="button" className="ui-dropzone-browse" disabled={disabled} onClick={browse}>
          <strong>{multiple ? "Drop files or click to browse" : "Drop a sample document or click to browse"}</strong>
          {hint ? <span>{hint}</span> : null}
          {children}
        </button>
      )}
    </div>
  );
}
