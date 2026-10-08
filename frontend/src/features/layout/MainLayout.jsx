import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavigationLink } from "../context/NavigationLink.jsx";
import { IconButton } from "../ui/Button.jsx";
import { Tooltip } from "../ui/Tooltip.jsx";
import { ContextDrawerContext } from "./ContextDrawerContext.js";
import {
  AdminIcon,
  DocumentIcon,
  EvaluationIcon,
  SidebarIcon,
  TemplateIcon,
  UploadIcon,
  WorkspaceIcon,
} from "./Icons.jsx";
import "./ConnectivityBanner.css";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "studio.sidebarCollapsed";

const MODEL_SETUP_MESSAGE = "Set up a Model gateway on the Workspace page to upload";

const SIDEBAR_ITEMS = [
  { id: "workspace", label: "Workspaces", icon: WorkspaceIcon },
  { id: "templates", label: "Templates", icon: TemplateIcon },
  { id: "documents", label: "Documents", icon: DocumentIcon },
  { id: "evaluations", label: "Evaluations", icon: EvaluationIcon },
];

const ADMIN_SIDEBAR_ITEM = { id: "admin", label: "Admin", icon: AdminIcon };

export function MainLayout({
  activePage,
  contentClassName = "",
  contentSelection = "",
  counts,
  isUploadDisabled,
  isModelSetupRequired = false,
  liveUpdatesPaused = false,
  onNavigate,
  navigationHref,
  onUploadDocument,
  profileSlot,
  contextSidebar,
  contextListLabel = "",
  showAdminNavigation = false,
  impersonationSlot = null,
  children,
  modalSlot,
}) {
  const [isSidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const collapseLabel = isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const mainRef = useRef(null);
  useContentFade(mainRef, activePage, contentSelection);
  const isOnline = useOnlineStatus();
  const contextDrawer = useContextDrawer(Boolean(contextSidebar));

  const connectivityMessage = !isOnline
    ? "You're offline"
    : liveUpdatesPaused
      ? "Live updates paused, reconnecting…"
      : "";

  const uploadButton = (
    <button
      type="button"
      className="sidebar-upload-button"
      data-tour="upload-open"
      aria-disabled={isModelSetupRequired ? "true" : undefined}
      title={isSidebarCollapsed ? undefined : isModelSetupRequired ? MODEL_SETUP_MESSAGE : undefined}
      disabled={isUploadDisabled}
      onClick={isModelSetupRequired ? () => onNavigate("workspace") : onUploadDocument}
    >
      <span className="sidebar-upload-icon" aria-hidden="true">
        <UploadIcon />
      </span>
      <span className="sidebar-upload-label">Upload documents</span>
    </button>
  );

  // The collapsed rail shows the label as a tooltip; the button keeps its name.
  const uploadControl = isSidebarCollapsed ? (
    <Tooltip
      content={isModelSetupRequired ? MODEL_SETUP_MESSAGE : "Upload documents"}
      placement="right"
      describe={isModelSetupRequired}
    >
      {uploadButton}
    </Tooltip>
  ) : (
    uploadButton
  );

  const drawerValue = contextSidebar ? { ...contextDrawer, label: contextListLabel } : null;

  return (
    <ContextDrawerContext.Provider value={drawerValue}>
      <div className={isSidebarCollapsed ? "app-frame sidebar-collapsed" : "app-frame"}>
        <aside className="left-sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-text">
              <p className="eyebrow">Document Extraction</p>
              <h1>Studio</h1>
            </div>
            <span className="sidebar-brand-mark" aria-hidden="true">
              DX
            </span>
            <IconButton
              label={collapseLabel}
              title={`${collapseLabel} ([)`}
              icon={SidebarIcon}
              size="sm"
              className="sidebar-collapse-toggle"
              aria-expanded={!isSidebarCollapsed}
              onClick={toggleSidebar}
            />
          </div>

          <SidebarNavigation
            activePage={activePage}
            counts={counts}
            isCollapsed={isSidebarCollapsed}
            showAdminNavigation={showAdminNavigation}
            onNavigate={onNavigate}
            navigationHref={navigationHref}
          />

          {uploadControl}

          <div className="sidebar-spacer" aria-hidden="true" />

          <div className="sidebar-footer">{profileSlot}</div>
        </aside>

        {contextSidebar ? (
          <div
            ref={contextDrawer.hostRef}
            className="context-drawer-host"
            onClick={(event) => {
              // Picking a row in the list closes the drawer so the page underneath is visible.
              if (event.target.closest?.("[data-context-select]")) contextDrawer.close();
            }}
          >
            {contextDrawer.isOpen ? (
              <button
                type="button"
                className="context-drawer-scrim"
                tabIndex={-1}
                aria-hidden="true"
                onClick={contextDrawer.close}
              />
            ) : null}
            {contextSidebar}
          </div>
        ) : null}

        <main ref={mainRef} className={`main-content ${contentClassName}`}>
          {connectivityMessage ? (
            <div role="status" className="connectivity-banner">
              {connectivityMessage}
            </div>
          ) : null}
          {impersonationSlot}
          {children}
        </main>

        {modalSlot}
      </div>
    </ContextDrawerContext.Provider>
  );
}

// The context list drawer below 1120px: open state, focus in on open, focus back to the
// toggle on close, Escape to close, and close after picking a row or widening the window.
function useContextDrawer(hasContextList) {
  const [isOpen, setIsOpen] = useState(false);
  const hostRef = useRef(null);
  const openerRef = useRef(null);
  const wasOpenRef = useRef(false);

  // The toggle is the trigger; focus returns to it when the drawer closes.
  const open = useCallback((trigger) => {
    openerRef.current = trigger instanceof Element ? trigger : document.activeElement;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback((event) => (isOpen ? close() : open(event?.currentTarget)), [isOpen, close, open]);

  useEffect(() => {
    if (!hasContextList) setIsOpen(false);
  }, [hasContextList]);

  useEffect(() => {
    if (isOpen) {
      // The search field comes first when the list has one; otherwise the first control.
      const drawerEl = hostRef.current?.querySelector(".context-sidebar");
      const target = drawerEl?.querySelector("input:not(:disabled)") ?? drawerEl?.querySelector("button:not(:disabled)");

      target?.focus();
    } else if (wasOpenRef.current && openerRef.current?.isConnected) {
      openerRef.current.focus();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  useEffect(() => {
    const media = window.matchMedia?.("(width > 1120px)");

    if (!media?.addEventListener) return undefined;

    const onChange = (event) => {
      if (event.matches) setIsOpen(false);
    };

    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  return { isOpen, hostRef, open, close, toggle };
}

// Tracks the browser's network state; the banner clears as soon as the browser reports it back.
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine !== false);

    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
}

// Softens the content swap when moving between pages or picking a different
// item in the context list. Selecting from nothing (or saving a draft into a new
// id) is not a swap, so it does not fade.
function useContentFade(ref, page, selection) {
  const previous = useRef({ page, selection });
  useEffect(() => {
    const before = previous.current;
    previous.current = { page, selection };
    const isSwap = page !== before.page || (selection && before.selection && selection !== before.selection);

    if (!isSwap || !ref.current?.animate) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    ref.current.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }, [ref, page, selection]);
}

// A per-browser preference: collapsing is a layout choice, not account state.
function useSidebarCollapsed() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => setIsCollapsed((current) => !current), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the toggle still works.
    }
  }, [isCollapsed]);

  useEffect(() => {
    function toggleOnShortcut(event) {
      if (
        event.key !== "[" ||
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"]')
      ) {
        return;
      }

      event.preventDefault();
      toggle();
    }

    window.addEventListener("keydown", toggleOnShortcut);

    return () => window.removeEventListener("keydown", toggleOnShortcut);
  }, [toggle]);

  return [isCollapsed, toggle];
}

function SidebarNavigation({ activePage, counts, isCollapsed, showAdminNavigation, onNavigate, navigationHref }) {
  const items = [...SIDEBAR_ITEMS, ...(showAdminNavigation ? [ADMIN_SIDEBAR_ITEM] : [])];

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {items.map((item) => {
        const ItemIcon = item.icon;

        const link = (
          <NavigationLink
            key={item.id}
            data-tour={`nav-${item.id}`}
            href={navigationHref?.(item.id)}
            className={item.id === activePage ? "sidebar-link active" : "sidebar-link"}
            aria-current={item.id === activePage ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-link-icon" aria-hidden="true">
              <ItemIcon />
            </span>
            <span className="sidebar-link-label">{item.label}</span>
            {item.id === "admin" ? null : <span className="sidebar-link-count">{counts[item.id] ?? ""}</span>}
          </NavigationLink>
        );

        // The collapsed rail shows the label as a tooltip; the link keeps the label as its name.
        return isCollapsed ? (
          <Tooltip key={item.id} content={item.label} placement="right" describe={false}>
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}
