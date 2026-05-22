import React from "react";

export function ContextSidebar({ title, children, footer }) {
  return (
    <aside className="context-sidebar">
      <div className="context-head">
        <p className="eyebrow">Control Center</p>
        <h2>{title}</h2>
      </div>

      {children}

      <div className="context-foot">{footer}</div>
    </aside>
  );
}
