import React from "react";
import "./Table.css";

// Table with the shared header, row rules and hover. Callers render thead and tbody themselves.
export function DataTable({ label, compact, matrix, className, style, children }) {
  const classes = ["table", compact ? "table--compact" : null, matrix ? "table--matrix" : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <table className={classes} aria-label={label} style={style}>
      {children}
    </table>
  );
}
