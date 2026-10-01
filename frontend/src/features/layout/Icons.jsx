import React from "react";

// Shared line icons: 24px grid, square corners to match the hairline UI.
function Icon({ size = 15, children }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {children}
    </svg>
  );
}

export function CopyIcon(props) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" />
      <path d="M15 5V4H4v11h1" />
    </Icon>
  );
}

export function EditIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
      <path d="m13 7 4 4" />
    </Icon>
  );
}
