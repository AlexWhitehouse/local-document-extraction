import React, { useEffect, useRef, useState } from "react";
import { copyWithFeedback } from "../../lib/copyWithFeedback";
import { defaultToast } from "../../lib/notify";
import { CopyIcon } from "../layout/Icons.jsx";

const CHECK_DURATION_MS = 1500;

export function ContextCopyButton({ ariaLabel, label = "ID", value, toast = defaultToast }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function handleCopy() {
    if (!(await copyWithFeedback(toast, value, label))) return;

    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), CHECK_DURATION_MS);
  }

  return (
    <button
      type="button"
      className="context-copy-button"
      aria-label={ariaLabel}
      title={ariaLabel}
      data-copied={copied ? "true" : undefined}
      onClick={handleCopy}
    >
      {copied ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="square"
          strokeLinejoin="miter"
        >
          <path d="M4 12.5 9.5 18 20 6" />
        </svg>
      ) : (
        <CopyIcon />
      )}
    </button>
  );
}
