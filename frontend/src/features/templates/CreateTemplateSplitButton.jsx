import React from "react";
import { Button } from "../ui/Button.jsx";
import { ChevronDownIcon } from "../layout/Icons.jsx";
import { TemplateActionMenu } from "./TemplateActionMenu.jsx";

// "Create template" with a menu for the other ways to start one.
export function CreateTemplateSplitButton({ disabled = false, onCreate, onAutoGenerate }) {
  return (
    <div className="create-template-split">
      <Button variant="secondary" data-tour="create-template" disabled={disabled} onClick={onCreate}>
        Create template
      </Button>
      <TemplateActionMenu
        label="More ways to create a template"
        icon={ChevronDownIcon}
        size="md"
        disabled={disabled}
        className="create-template-split-toggle"
        items={[
          { key: "blank", label: "Blank template", onSelect: onCreate },
          { key: "generate", label: "Auto-generate from sample", onSelect: onAutoGenerate },
        ]}
      />
    </div>
  );
}
