import React from "react";

export function PageHeading({ eyebrow, title, description, children }) {
  return <header className="lp-page-heading">
    <p className="lp-kicker">{eyebrow}</p>
    <h1 title={title}>{title}</h1>
    <div className="lp-heading-actions">{children}</div>
    <p className="lp-page-description">{description}</p>
  </header>;
}

export function SectionHeading({ title, description, children }) {
  return <div className="lp-section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</div>;
}

export function Status({ children, warn = false }) {
  return <span className={`lp-status${warn ? " lp-status-warn" : ""}`}><i aria-hidden="true" />{children}</span>;
}

export function Confidence({ value }) {
  return <span className={`lp-confidence${value < 90 ? " lp-confidence-warn" : ""}`}><span aria-hidden="true" className="lp-confidence-track"><i style={{ width: `${value}%` }} /></span>{value.toFixed(1)}%</span>;
}
