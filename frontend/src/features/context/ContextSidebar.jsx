import React, { useContext } from "react";
import { IconButton } from "../ui/Button.jsx";
import { CloseIcon } from "../layout/Icons.jsx";
import { ContextDrawerContext } from "../layout/ContextDrawerContext.js";

// The context list. Below 1120px MainLayout shows it as a drawer; the close button only shows there.
export function ContextSidebar({ title, children, footer }) {
  const drawer = useContext(ContextDrawerContext);

  return (
    <aside className={drawer?.isOpen ? "context-sidebar is-open" : "context-sidebar"}>
      <div className="context-head">
        <h2>{title}</h2>
        {drawer ? (
          <IconButton
            label="Hide list"
            className="context-drawer-close"
            icon={CloseIcon}
            size="sm"
            onClick={drawer.close}
          />
        ) : null}
      </div>

      {children}

      <div className="context-foot">{footer}</div>
    </aside>
  );
}
