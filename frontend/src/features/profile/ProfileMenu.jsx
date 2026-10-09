import React, { useEffect, useRef } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ChevronDownIcon, CloseIcon } from "../layout/Icons.jsx";
import { Button, IconButton } from "../ui/Button.jsx";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
import { Segmented } from "../ui/Tabs.jsx";
import { useThemePreference } from "../../lib/theme.js";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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

  const [themePreference, setThemePreference] = useThemePreference();
  const shortcutsRef = useRef(null);
  const focusShortcutsOnOpen = useRef(false);

  // "?" opens Settings at the keyboard shortcuts section. Like "[" in MainLayout, it is ignored
  // while typing and while a dialog is already open.
  useEffect(() => {
    function openFromShortcut(event) {
      if (
        event.key !== "?" ||
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"]') ||
        document.querySelector('[role="dialog"], [aria-modal="true"]')
      ) {
        return;
      }

      event.preventDefault();
      focusShortcutsOnOpen.current = true;
      onToggle();
    }

    window.addEventListener("keydown", openFromShortcut);

    return () => window.removeEventListener("keydown", openFromShortcut);
  }, [onToggle]);

  useEffect(() => {
    if (!isOpen || !focusShortcutsOnOpen.current) return;

    focusShortcutsOnOpen.current = false;
    shortcutsRef.current?.scrollIntoView?.({ block: "start" });
    shortcutsRef.current?.focus();
  }, [isOpen]);

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
                    <h2 id="settings-modal-title">Settings</h2>
                  </div>
                  {tourAction ? <div className="settings-modal-tour">{tourAction}</div> : null}
                </aside>

                <section className="settings-modal-content">
                  <header className="settings-modal-header">
                    <div>
                      <h3>Profile</h3>
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
                    <div className="settings-form-card">
                      <Field label="Name">
                        <TextInput
                          value={draftName}
                          onChange={(event) => onDraftNameChange(event.target.value)}
                          placeholder="e.g. Jane Doe"
                          autoComplete="name"
                        />
                      </Field>
                      <Field label="Email">
                        <TextInput value={displayEmail} readOnly aria-readonly="true" />
                      </Field>
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
                    <section className="settings-appearance" aria-labelledby="settings-appearance-title">
                      <div className="settings-section-intro">
                        <h4 id="settings-appearance-title">Appearance</h4>
                      </div>
                      <Segmented
                        label="Theme"
                        items={THEME_OPTIONS}
                        value={themePreference}
                        onChange={setThemePreference}
                      />
                    </section>
                    <section
                      ref={shortcutsRef}
                      tabIndex={-1}
                      className="settings-shortcuts"
                      aria-labelledby="settings-shortcuts-title"
                    >
                      <div className="settings-section-intro">
                        <h4 id="settings-shortcuts-title">Keyboard shortcuts</h4>
                      </div>
                      <dl className="settings-shortcut-list">
                        <div>
                          <dt>
                            <kbd>[</kbd>
                          </dt>
                          <dd>Collapse or expand the sidebar</dd>
                        </div>
                        <div>
                          <dt>
                            <kbd>?</kbd>
                          </dt>
                          <dd>Show keyboard shortcuts</dd>
                        </div>
                        <div>
                          <dt>
                            <kbd>↑</kbd> <kbd>↓</kbd>
                          </dt>
                          <dd>Move between documents in the list. Home and End jump to the first and last.</dd>
                        </div>
                      </dl>
                    </section>
                    <div className="settings-form-actions">
                      <Button
                        variant="secondary"
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
