import React from "react";

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
        {templates.slice(0, 12).map((template) => (
          <button
            type="button"
            key={`context-${template.id}`}
            className={getTemplateItemClassName({
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
            <span>{template.is_draft ? "Unsaved" : template.id}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function getTemplateItemClassName({ template, selectedTemplateId, isEditingTemplate }) {
  if (template.is_draft) {
    return !isEditingTemplate ? "context-item active" : "context-item";
  }
  return selectedTemplateId === template.id
    ? "context-item active"
    : "context-item";
}
