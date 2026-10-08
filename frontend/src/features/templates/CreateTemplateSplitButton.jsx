import React from "react";
import { Button, IconButton } from "../ui/Button.jsx";
import { MagicIcon } from "../layout/Icons.jsx";
import "./CreateTemplateSplitButton.css";

// "Create template" with a joined magic-wand button that auto-generates a template from a sample.
export function CreateTemplateSplitButton({ disabled = false, onCreate, onAutoGenerate }) {
  return (
    <div className="create-template-split" role="group" aria-label="Create template">
      <Button variant="secondary" data-tour="create-template" disabled={disabled} onClick={onCreate}>
        Create template
      </Button>
      <IconButton
        variant="secondary"
        label="Auto-generate template"
        icon={MagicIcon}
        size="md"
        disabled={disabled}
        className="create-template-magic"
        onClick={onAutoGenerate}
      />
    </div>
  );
}
