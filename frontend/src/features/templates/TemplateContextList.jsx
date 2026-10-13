import React, { useState } from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ContextCopyButton } from "../context/ContextCopyButton.jsx";
import { useRowMotion } from "../context/useRowMotion.js";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { ListStatus } from "../ui/States.jsx";
import { appPath } from "../../lib/appRoutes";
import { Button } from "../ui/Button.jsx";
import { LoadMore } from "../ui/Pager.jsx";

const TEMPLATE_PAGE_SIZE = 12;

export function TemplateContextList({
  workspaceId,
  templates,
  status = "ready",
  error,
  selectedTemplateId,
  isEditingTemplate,
  onRetry,
  onCreateTemplate,
  onAutoGenerateTemplate,
  onSelectDraftTemplate,
  onSelectTemplate,
}) {
  const rowMotion = useRowMotion(templates, (template) => template.id);
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_PAGE_SIZE);
  const remainingCount = templates.length - visibleCount;

  return (
    <ScrollArea className="context-list" role="region" aria-label="Template list" tabIndex={0}>
      <ListStatus
        status={status}
        error={error}
        onRetry={onRetry}
        isEmpty={!templates.length}
        emptyMessage="No templates yet."
        emptyAction={
          <>
            <Button type="button" onClick={() => onCreateTemplate()}>
              Create template
            </Button>
            <Button type="button" variant="secondary" onClick={() => onAutoGenerateTemplate()}>
              Generate from a sample
            </Button>
          </>
        }
      >
        {templates.slice(0, visibleCount).map((template) => {
          const itemDetail = template.is_draft ? "Unsaved" : template.id;
          const isActive = template.is_draft ? !isEditingTemplate : selectedTemplateId === template.id;

          return (
            <div
              key={`context-${template.id}`}
              className={(isActive ? "context-item-card active" : "context-item-card") + rowMotion(template.id)}
            >
              <NavigationLink
                href={
                  workspaceId
                    ? appPath({ workspaceId, page: "templates", templateId: template.is_draft ? "new" : template.id })
                    : undefined
                }
                className={isActive ? "context-item-main active" : "context-item-main"}
                data-context-select aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  if (template.is_draft) {
                    onSelectDraftTemplate();
                  } else {
                    onSelectTemplate(template.id);
                  }
                }}
              >
                <strong>{template.is_draft ? "New template" : template.name || "Untitled template"}</strong>
                <span>{itemDetail}</span>
              </NavigationLink>
              <ContextCopyButton ariaLabel={`Copy template ID ${itemDetail}`} value={itemDetail} />
            </div>
          );
        })}
        {remainingCount > 0 ? (
          <LoadMore label="Load more templates" onLoadMore={() => setVisibleCount((count) => count + TEMPLATE_PAGE_SIZE)} />
        ) : null}
      </ListStatus>
    </ScrollArea>
  );
}
