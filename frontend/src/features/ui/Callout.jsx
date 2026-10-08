import React from "react";
import "./Callout.css";

// Persistent inline message: tone info | warning | danger | success, with an optional action.
export function Callout({ tone = "info", title, action, role, className, children, ...rest }) {
  return (
    <div {...rest} className={["ui-callout", `ui-tone-${tone}`, className].filter(Boolean).join(" ")} role={role}>
      <div className="ui-callout-body">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="ui-callout-action">{action}</div> : null}
    </div>
  );
}
