import React from "react";

// The one icon set: 24px grid, square caps and mitred joins to match the hairline UI.
// Icons are decorative; the control that holds one carries the accessible label.
function Icon({ size = 15, className, children }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
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

export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="m5 12 4.5 4.5L19 7" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <Icon {...props}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  );
}

export function ChevronRightIcon(props) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowUpIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

export function ArrowDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  );
}

export function MoreIcon(props) {
  return (
    <Icon {...props}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </Icon>
  );
}

export function PlayIcon(props) {
  return (
    <Icon {...props}>
      <path d="M7 5v14l11-7Z" />
    </Icon>
  );
}

export function ExternalIcon(props) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v6H4V6h6" />
    </Icon>
  );
}

export function FilterIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 5h16M7 12h10M10 19h4" />
    </Icon>
  );
}

export function PacketIcon(props) {
  return (
    <Icon {...props}>
      <path d="M8 3h11v14" />
      <rect x="5" y="7" width="11" height="14" />
    </Icon>
  );
}

export function SidebarIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M9 4v16" />
    </Icon>
  );
}

export function MagicIcon(props) {
  return (
    <Icon {...props}>
      <path d="m3 18 12-12 3 3L6 21Z" />
      <path d="m12 9 4 4M5 3v4M3 5h4M19 2v6M16 5h6M20 17v4M18 19h4" />
    </Icon>
  );
}

export function AssistantIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v11H9l-5 4Z" />
      <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" />
    </Icon>
  );
}

export function UploadIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v5h16v-5" />
    </Icon>
  );
}

export function TrashIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </Icon>
  );
}

export function WorkspaceIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 9h18" />
    </Icon>
  );
}

export function TemplateIcon(props) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  );
}

export function DocumentIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4" />
    </Icon>
  );
}

export function EvaluationIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

export function AdminIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" />
    </Icon>
  );
}
