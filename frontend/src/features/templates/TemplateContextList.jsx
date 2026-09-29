import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";

export function TemplateContextList({
  search,
  templates,
  selectedTemplateId,
  isEditingTemplate,
  onSearchChange,
  onSelectDraftTemplate,
  onSelectTemplate,
}) {
  return (
    <>
      <label>
        Search Templates
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Template name or ID"
        />
      </label>
      <ScrollArea className="context-list" role="region" aria-label="Template list" tabIndex={0}>
        {templates.slice(0, 12).map((template) => {
          const itemDetail = template.is_draft ? "Unsaved" : template.id;
          const isActive = template.is_draft ? !isEditingTemplate : selectedTemplateId === template.id;
          return (
            <div
              key={`context-${template.id}`}
              className={isActive ? "context-item-card active" : "context-item-card"}
            >
              <button
                type="button"
                className={isActive ? "context-item-main active" : "context-item-main"}
                onClick={() => {
                  if (template.is_draft) {
                    onSelectDraftTemplate();
                  } else {
                    onSelectTemplate(template.id);
                  }
                }}
              >
                <strong>
                  {template.is_draft
                    ? "New Template Draft"
                    : template.name || "Untitled template"}
                </strong>
                <span>{itemDetail}</span>
              </button>
              <ContextCopyButton
                ariaLabel={`Copy template ID ${itemDetail}`}
                value={itemDetail}
              />
            </div>
          );
        })}
      </ScrollArea>
    </>
  );
}

