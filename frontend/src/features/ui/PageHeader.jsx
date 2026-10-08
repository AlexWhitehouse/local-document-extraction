import React, { useContext, useEffect, useState } from "react";
import { isString } from "../../../../shared/json.ts";
import { ActionMenu } from "./ActionMenu.jsx";
import { Button, IconButton } from "./Button.jsx";
import { MoreIcon, SidebarIcon } from "../layout/Icons.jsx";
import { ContextDrawerContext } from "../layout/ContextDrawerContext.js";
import { NavigationLink } from "../context/NavigationLink.jsx";
import "./PageHeader.css";

const COMPACT_QUERY = "(max-width: 600px)";

// The one page header: linked breadcrumbs, title, an optional one-line description,
// actions, and an overflow menu for destructive or rare actions.
// titleText is the plain-text title for the truncation tooltip when `title` is not a string.
// breadcrumbs: [{ label, href?, onClick? }]; overflowActions: [{ key, label, onSelect, danger?, disabled? }]
// compactActions: [{ key, label, onSelect, disabled?, ...buttonProps }] are buttons above 600px and move into the
// overflow menu at 600px and below.
// Below 1120px, a toggle for the context list drawer appears first in the actions (see MainLayout).
export function PageHeader({
  label,
  breadcrumbs = [],
  title,
  titleText,
  description,
  actions,
  overflowActions = [],
  compactActions = [],
  children,
}) {
  const drawer = useContext(ContextDrawerContext);
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const visibleOverflow = overflowActions.filter(Boolean);
  const visibleCompact = compactActions.filter(Boolean);
  const inlineCompact = isCompact ? [] : visibleCompact;
  const menuItems = [...(isCompact ? visibleCompact : []), ...visibleOverflow];
  const tooltip = titleText ?? (isString(title) ? title : undefined);
  const hasActions = Boolean(actions) || inlineCompact.length > 0 || menuItems.length > 0 || Boolean(drawer);

  return (
    <header className="studio-page-heading ui-page-header" aria-label={label || `${title} page`}>
      {breadcrumbs.length ? (
        <nav className="ui-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`}>
                {crumb.href || crumb.onClick ? (
                  <NavigationLink href={crumb.href} onClick={crumb.onClick}>
                    {crumb.label}
                  </NavigationLink>
                ) : (
                  <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 title={tooltip}>{title}</h1>
      {description ? <p className="ui-page-description">{description}</p> : null}
      {hasActions ? (
        <div className="studio-heading-actions">
          {drawer ? (
            <IconButton
              label={drawer.label ? `Show ${drawer.label.toLowerCase()} list` : "Show list"}
              icon={SidebarIcon}
              size="md"
              className="context-drawer-toggle"
              aria-expanded={drawer.isOpen}
              onClick={drawer.toggle}
            />
          ) : null}
          {inlineCompact.map(({ key, label: actionLabel, onSelect, disabled, ...buttonProps }) => (
            <Button key={key} variant="secondary" disabled={disabled} onClick={onSelect} {...buttonProps}>
              {actionLabel}
            </Button>
          ))}
          {actions}
          {menuItems.length ? <ActionMenu label="More actions" icon={MoreIcon} size="md" items={menuItems} /> : null}
        </div>
      ) : null}
      {children}
    </header>
  );
}

// Tracks a media query so the header can switch between inline and overflow actions.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => Boolean(window.matchMedia?.(query).matches));

  useEffect(() => {
    const media = window.matchMedia?.(query);

    if (!media) return undefined;

    const update = () => setMatches(Boolean(media.matches));

    update();
    media.addEventListener?.("change", update);

    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}
