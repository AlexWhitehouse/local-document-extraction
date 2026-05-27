import React from "react";
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
      <div className="context-list">
        {templates.slice(0, 12).map((template) => {
          const itemDetail = template.is_draft ? "Unsaved" : template.id;
          return (
            <div
              key={`context-${template.id}`}
              className={getTemplateItemClassName({
                template,
                selectedTemplateId,
                isEditingTemplate,
              })}
            >
              <button
                type="button"
                className={getTemplateItemButtonClassName({
                  template,
                  selectedTemplateId,
                  isEditingTemplate,
                })}
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
      </div>
    </>
  );
}

function getTemplateItemClassName({ template, selectedTemplateId, isEditingTemplate }) {
  if (template.is_draft) {
    return !isEditingTemplate ? "context-item-card active" : "context-item-card";
  }
  return selectedTemplateId === template.id
    ? "context-item-card active"
    : "context-item-card";
}

function getTemplateItemButtonClassName({
  template,
  selectedTemplateId,
  isEditingTemplate,
}) {
  return getTemplateItemClassName({
    template,
    selectedTemplateId,
    isEditingTemplate,
  }).replace("context-item-card", "context-item-main");
}
