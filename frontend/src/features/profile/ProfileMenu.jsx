import React from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ChevronDownIcon, CloseIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";

export const ProfileMenu = React.forwardRef(function ProfileMenu(
  {
    displayName,
    displayEmail,
    draftName,
    isOpen,
    isDirty,
    isSavingProfile,
    canSaveProfile,
    saveError,
    isSigningOut,
    onToggle,
    onDraftNameChange,
    onSaveProfile,
    onSignOut,
    tourAction,
  },
  ref,
) {
  // Escape and the backdrop go through ModalDialog's dirty check; the × does too.
  const requestClose = async () => {
    if (!isDirty || (await confirmDialog({ ...DISCARD_CHANGES }))) onToggle();
  };

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
          <ChevronDownIcon size={14} />
        </span>
      </button>

      {isOpen ? (
        <ModalDialog labelledBy="settings-modal-title" className="settings-modal" isDirty={isDirty} onClose={onToggle}>
          {/* Not a ModalHeader: the × sits in the content column, not a header strip. */}
          <>
                <aside className="settings-modal-sidebar">
                  <div className="settings-modal-brand">
                    <span className="eyebrow">Local Studio</span>
                    <h2 id="settings-modal-title">Settings</h2>
                  </div>
                  {tourAction ? <div className="settings-modal-tour">{tourAction}</div> : null}
                  <p>Manage your local account.</p>
                </aside>

                <section className="settings-modal-content">
                  <header className="settings-modal-header">
                    <div>
                      <span className="eyebrow">Identity</span>
                      <h3>Account</h3>
                    </div>
                    <IconButton
                      size="sm"
                      label="Close settings"
                      icon={CloseIcon}
                      className="modal-close"
                      onClick={requestClose}
                    />
                  </header>

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
                      {saveError ? (
                        <p className="form-error" role="alert">
                          {saveError}
                        </p>
                      ) : null}
                      <div className="settings-form-actions">
                        <Button
                          pending={isSavingProfile}
                          pendingLabel="Saving…"
                          disabled={!isDirty || !canSaveProfile}
                          onClick={onSaveProfile}
                        >
                          Save profile
                        </Button>
                      </div>
                    </div>
                    <div className="settings-danger-row">
                      <div>
                        <strong>End this session</strong>
                        <span>You’ll need to sign in again to access local workspaces.</span>
                      </div>
                      <Button
                        variant="danger"
                        pending={isSigningOut}
                        pendingLabel="Signing out…"
                        disabled={isSavingProfile}
                        onClick={onSignOut}
                      >
                        Sign out
                      </Button>
                    </div>
                  </div>
                </section>
          </>
        </ModalDialog>
      ) : null}
    </div>
  );
});

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
