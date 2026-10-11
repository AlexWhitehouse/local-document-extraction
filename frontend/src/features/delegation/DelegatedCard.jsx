import React from "react";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { ErrorState } from "../ui/States.jsx";
import "./delegation.css";

// The focused card for pages an MCP client links to: consent, approvals and uploads.
// It keeps the sign-in screen's frame, without the Studio sidebar or Workspace context.
export function DelegatedCard({ eyebrow, title, description, status, children }) {
  return (
    <div className="auth-shell">
      <section className="auth-card delegated-card" aria-label={title}>
        <div className="auth-header">
          <p className="eyebrow">{eyebrow}</p>
          <div className="delegated-title">
            <h1>{title}</h1>
            {status}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
        {children}
        <p className="delegated-footer">
          <a href="/">Open Studio</a>
          <a href="/connected-apps">Connected apps</a>
        </p>
      </section>
    </div>
  );
}

export function DelegatedSignedInAs({ account, disabled, onSignOut }) {
  return (
    <p className="delegated-account muted">
      <span>
        Signed in as <b>{account}</b>
      </span>
      <Button variant="text" disabled={disabled} onClick={onSignOut}>
        Use another account
      </Button>
    </p>
  );
}

// A load failure keeps the card frame and offers a retry.
export function DelegatedLoadFailure({ error, fallback, onRetry }) {
  return <ErrorState variant="panel" error={error} fallback={fallback} onRetry={onRetry} />;
}

// Impersonated sessions can look but never change delegated access on the user's behalf.
export function ImpersonationNotice({ children }) {
  return (
    <Callout tone="warning" title="You're impersonating this user">
      {children}
    </Callout>
  );
}
