import React from "react";

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
        onClick={onToggle}
      >
        <span className="sidebar-profile-avatar" aria-hidden="true">
          {profileInitials(displayName, displayEmail)}
        </span>
        <span className="sidebar-profile-meta">
          <strong>{displayName}</strong>
          <span>{displayEmail}</span>
        </span>
      </button>

      {isOpen ? (
        <div className="sidebar-profile-popout">
          <label>
            Name
            <input
              value={draftName}
              onChange={(event) => onDraftNameChange(event.target.value)}
              placeholder="Jane Doe"
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={isSavingProfile || !isDirty}
              onClick={onSaveProfile}
            >
              {isSavingProfile ? "Saving..." : "Save Profile"}
            </button>
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
