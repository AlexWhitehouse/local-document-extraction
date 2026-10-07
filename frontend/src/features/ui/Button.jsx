import React, { forwardRef } from "react";
import "./Button.css";

const VARIANT_CLASSES = {
  primary: "",
  secondary: "secondary",
  ghost: "ghost",
  danger: "danger",
  text: "studio-text-button",
  "danger-text": "studio-text-button studio-destructive",
};

function classes(...names) {
  return names.filter(Boolean).join(" ") || undefined;
}

// The one button. A pending button is disabled and shows its pending label.
export const Button = forwardRef(function Button(
  { variant = "primary", size = "md", pending = false, pendingLabel, disabled, className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes(VARIANT_CLASSES[variant], size === "sm" && "button-sm", className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
});

// Icon-only button. `label` is required: it is both the accessible name and the tooltip.
export const IconButton = forwardRef(function IconButton(
  { label, icon: IconComponent, size = "md", variant = "ghost", className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={classes("icon-button", `icon-button-${size}`, variant === "danger" && "icon-button-danger", className)}
      {...props}
    >
      {IconComponent ? <IconComponent size={size === "sm" ? 13 : 15} /> : children}
    </button>
  );
});
