import React from "react";
import { CopyIcon } from "../layout/Icons.jsx";

export function ContextCopyButton({ ariaLabel, value }) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // The sidebar copy affordance is intentionally silent if clipboard access is unavailable.
    }
  }

  return (
    <button
      type="button"
      className="context-copy-button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={handleCopy}
    >
      <CopyIcon />
    </button>
  );
}
