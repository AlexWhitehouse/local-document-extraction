import React, { useEffect, useRef, useState } from "react";
import { copyWithFeedback } from "../../lib/copyWithFeedback";
import { defaultToast } from "../../lib/notify";
import { CheckIcon, CopyIcon } from "../layout/Icons.jsx";
import { IconButton } from "../ui/Button.jsx";

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
    <IconButton
      label={ariaLabel}
      icon={copied ? CheckIcon : CopyIcon}
      size="sm"
      className="context-copy-button"
      data-copied={copied ? "true" : undefined}
      onClick={handleCopy}
    />
  );
}
