import React, { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "../layout/Icons.jsx";
import { Button } from "./Button.jsx";
import "./CopyField.css";

const COPIED_DURATION_MS = 1500;

// A read-only value joined to a Copy button, for links and addresses people pass on. A long
// value ends in an ellipsis on screen; Copy always copies all of it. `onCopy` resolves true
// once copied (see copyWithFeedback), and the button then shows a brief tick.
export function CopyField({
  label,
  labelHidden = false,
  value,
  hint,
  icon: IconComponent,
  copyLabel = "Copy",
  onCopy,
  className,
}) {
  const inputId = useId();
  const hintId = useId();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    if (!(await onCopy())) return;

    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_DURATION_MS);
  }

  return (
    <div className={["ui-field", "ui-copy-field", className].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={labelHidden ? "sr-only" : "ui-field-label"}>
        {label}
      </label>
      <div className="ui-copy-field-control">
        {IconComponent ? (
          <span className="ui-copy-field-icon">
            <IconComponent size={13} />
          </span>
        ) : null}
        <input
          id={inputId}
          type="text"
          value={value}
          readOnly
          spellCheck={false}
          title={value}
          aria-describedby={hint ? hintId : undefined}
          // Selecting on focus leaves a manual copy one keystroke away if the clipboard is blocked.
          onFocus={(event) => event.target.select()}
        />
        <Button variant="secondary" size="sm" className="ui-copy-field-button" data-copied={copied || undefined} onClick={copy}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? "Copied" : copyLabel}
        </Button>
      </div>
      {hint ? (
        <p id={hintId} className="ui-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
