import React from "react";
import { createPortal } from "react-dom";

export const ProfileMenu = React.forwardRef(function ProfileMenu(
  {
    displayName,
    displayEmail,
    draftName,
    isOpen,
    isDirty,
    isSavingProfile,
    busy,
    onToggle,
    onDraftNameChange,
    onSaveProfile,
    onSignOut,
  },
  ref,
) {
  return (
    <div className="sidebar-profile" ref={ref}>
      <button
        type="button"
        className="sidebar-profile-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="sidebar-profile-avatar" aria-hidden="true">
          {profileInitials(displayName, displayEmail)}
        </span>
        <span className="sidebar-profile-meta">
          <strong>{displayName}</strong>
          <span>{displayEmail}</span>
        </span>
        <span className="sidebar-profile-chevron" aria-hidden="true">
          ⌃
        </span>
      </button>

      {isOpen
        ? createPortal(
            <div className="settings-modal-backdrop" onClick={onToggle}>
              <div
                className="settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <aside className="settings-modal-sidebar">
                  <div className="settings-modal-brand">
                    <span className="eyebrow">Local Studio</span>
                    <h2 id="settings-modal-title">Settings</h2>
                  </div>
                  <p>Manage your local account.</p>
                </aside>

                <section className="settings-modal-content">
                  <header className="settings-modal-header">
                    <div>
                      <span className="eyebrow">Identity</span>
                      <h3>Account</h3>
                    </div>
                    <button
                      type="button"
                      className="settings-modal-close"
                      aria-label="Close settings"
                      onClick={onToggle}
                    >
                      ×
                    </button>
                  </header>

                    <AccountSettings
                      busy={busy}
                      displayEmail={displayEmail}
                      draftName={draftName}
                      isDirty={isDirty}
                      isSavingProfile={isSavingProfile}
                      onDraftNameChange={onDraftNameChange}
                      onSaveProfile={onSaveProfile}
                      onSignOut={onSignOut}
                    />
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function AccountSettings({
  busy,
  displayEmail,
  draftName,
  isDirty,
  isSavingProfile,
  onDraftNameChange,
  onSaveProfile,
  onSignOut,
}) {
  return (
    <div className="settings-section-body">
      <div className="settings-section-intro">
        <h4>Your local profile</h4>
        <p>Update the name shown throughout Document Extraction.</p>
      </div>
      <div className="settings-form-card">
        <label>
          Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        </label>
        <label>
          Email
          <input value={displayEmail} readOnly aria-readonly="true" />
        </label>
        <div className="settings-form-actions">
          <button
            type="button"
            disabled={isSavingProfile || !isDirty}
            onClick={onSaveProfile}
          >
            {isSavingProfile ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>
      <div className="settings-danger-row">
        <div>
          <strong>End this session</strong>
          <span>You’ll need to sign in again to access local workspaces.</span>
        </div>
        <button
          type="button"
          className="danger"
          disabled={busy || isSavingProfile}
          onClick={onSignOut}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

function profileInitials(name, email) {
  const source = String(name || "").trim() || String(email || "").trim();
  if (!source) {
    return "U";
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}
