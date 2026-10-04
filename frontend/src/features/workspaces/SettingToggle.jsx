import React, { useId } from "react";

/** A settings checkbox with its title and help text aligned in one column beside it. */
export function SettingToggle({ label, description, checked, disabled, onChange }) {
  const id = useId();

  return (
    <div className={`studio-setting-toggle${disabled ? " is-disabled" : ""}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="studio-setting-toggle-label">
        {label}
      </label>
      {description ? (
        <p id={`${id}-description`} className="studio-setting-toggle-description">
          {description}
        </p>
      ) : null}
    </div>
  );
}
