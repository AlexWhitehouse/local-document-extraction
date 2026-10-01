import React from "react";
import { scalarValue } from "./evaluationScoring.js";

export function DateFormatSelect({ value, onChange }) {
  return <label className="evaluation-date-format">Date format<select aria-label="Date format" value={value} onChange={event => onChange(event.target.value)}>
    <option value="dmy">DD/MM/YYYY · day first</option><option value="mdy">MM/DD/YYYY · month first</option>
  </select><small>YYYY-MM-DD and written month names also work.</small></label>;
}

export function DatePreview({ value, dateOrder }) {
  const parsed = scalarValue(value, "date", false, dateOrder);
  return parsed.valid ? <small className="evaluation-input-hint">Interpreted as {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${parsed.value}T00:00:00Z`))}</small> : null;
}
