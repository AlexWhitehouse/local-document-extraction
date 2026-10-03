import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { appPath } from "../../lib/appRoutes";

export function TemplateContextList({
  workspaceId,
  search,
  templates,
  selectedTemplateId,
  isEditingTemplate,
  onSearchChange,
  onSelectDraftTemplate,
  onSelectTemplate,
}) {
  const rowMotion = useRowMotion(templates, (template) => template.id);
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
              className={(isActive ? "context-item-card active" : "context-item-card") + rowMotion(template.id)}
            >
              <NavigationLink
                href={workspaceId ? appPath({ workspaceId, page: "templates", templateId: template.is_draft ? "new" : template.id }) : undefined}
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
              </NavigationLink>
              <ContextCopyButton
                ariaLabel={`Copy template ID ${itemDetail}`}
                value={itemDetail}
              />
            </div>
          );
        })}
        {!templates.length ? (
          <p className="muted">{String(search || "").trim() ? "No Templates match this search." : "No Templates yet."}</p>
        ) : templates.length > 12 ? (
          <p className="muted">Showing 12 of {templates.length}. Search to find the rest.</p>
        ) : null}
      </ScrollArea>
    </>
  );
}
