import React, { cloneElement, forwardRef, isValidElement, useId } from "react";
import "./Field.css";

// Label, hint and error around one control. Wires id, aria-describedby and
// aria-invalid onto the child so every form reports the same way.
export function Field({ label, hint, error, labelHidden = false, className, children }) {
  const generated = useId();
  const control = isValidElement(children) ? children : null;
  const id = control?.props.id || generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [control?.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["ui-field", error && "has-error", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={labelHidden ? "sr-only" : "ui-field-label"}>
        {label}
      </label>
      {control
        ? cloneElement(control, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
        : children}
      {hint ? (
        <p id={hintId} className="ui-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef(function TextInput({ type = "text", ...props }, ref) {
  return <input ref={ref} type={type} {...props} />;
});

export const Textarea = forwardRef(function Textarea(props, ref) {
  return <textarea ref={ref} {...props} />;
});

export const Select = forwardRef(function Select({ children, ...props }, ref) {
  return (
    <select ref={ref} {...props}>
      {children}
    </select>
  );
});

// A checkbox with its title and optional description aligned beside it.
export function CheckboxField({ label, description, checked, disabled, onChange, className, ...props }) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={["ui-checkbox-field", disabled && "is-disabled", className].filter(Boolean).join(" ")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.checked)}
        {...props}
      />
      <label htmlFor={id} className="ui-checkbox-field-label">
        {label}
      </label>
      {description ? (
        <p id={descriptionId} className="ui-checkbox-field-description">
          {description}
        </p>
      ) : null}
    </div>
  );
}
