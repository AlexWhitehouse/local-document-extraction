import React from "react";

export function ContextCopyButton({ ariaLabel, value }) {
  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(String(value ?? ""));
    } catch {
      // The sidebar copy affordance is intentionally silent if clipboard access is denied.
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

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
