import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STAGES } from "./sampleCosts.js";
import { costLabel, percent } from "./costFormat.js";
import { EARLIEST, PRESETS } from "./costRange.js";
import { TODAY } from "./sampleCosts.js";

export function ChartTip({ tip }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const left = Math.min(tip.x + 14, window.innerWidth - box.width - 8);
    const top = tip.y + 14 + box.height > window.innerHeight - 8 ? tip.y - box.height - 10 : tip.y + 14;
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [tip]);
  if (!tip) return null;
  return createPortal(<div ref={ref} role="tooltip" className="cp-tip" style={position || { left: tip.x + 14, top: tip.y + 14, visibility: "hidden" }}>{tip.content}</div>, document.body);
}

/** Tooltip body for any document or packet: stage rows, then the total. */
export function StageTipRows({ costs, title, meta }) {
  return <>
    {title ? <div className="cp-tip-title">{title}</div> : null}
    {meta ? <div className="cp-tip-meta">{meta}</div> : null}
    <dl>
      {STAGES.map(stage => <div key={stage.id}><dt><i className={`cp-swatch cp-stage-${stage.id}`} />{stage.label}</dt><dd>{costLabel(costs[stage.id], "—")}</dd></div>)}
      <div className="cp-tip-total"><dt>Total</dt><dd>{costLabel(costs.total)}</dd></div>
    </dl>
  </>;
}

export function StageLegend({ costs }) {
  const total = costs?.total.amount || 0;
  return <ul className="cp-legend" aria-label="Cost stages">
    {STAGES.map(stage => <li key={stage.id}>
      <i className={`cp-swatch cp-stage-${stage.id}`} aria-hidden="true" />
      <span>{stage.label}</span>
      {costs ? <strong>{costs[stage.id].reported_calls + costs[stage.id].unreported_calls ? <>{costLabel(costs[stage.id], "—")}{total ? <small> · {percent((costs[stage.id].amount || 0) / total)}</small> : null}</> : "—"}</strong> : null}
    </li>)}
  </ul>;
}

/** A horizontal stacked bar, 2px surface gaps between stages, scaled to `max`. */
export function StageBar({ costs, max, height = 8, label }) {
  const total = costs.total.amount;
  if (total === null) return <span className="cp-stagebar cp-stagebar-unavailable" role="img" aria-label={`${label || "Cost"} unavailable`}><span style={{ height }} /></span>;
  const share = max ? Math.max(total / max, total > 0 ? 0.01 : 0) : 1;
  return <span className="cp-stagebar" role="img" aria-label={`${label || "Cost"}: ${STAGES.map(stage => `${stage.label} ${costLabel(costs[stage.id], "unavailable")}`).join(", ")}`}>
    <span className="cp-stagebar-fill" style={{ width: `${share * 100}%`, height }}>
      {STAGES.filter(stage => costs[stage.id].amount > 0).map(stage => <span key={stage.id} className={`cp-stage-${stage.id}`} style={{ flexGrow: (1000 * costs[stage.id].amount) / total }} />)}
    </span>
    {!costs.total.complete ? <span className="cp-stagebar-partial" title="Some calls did not report cost" aria-hidden="true">+</span> : null}
  </span>;
}

export function Segmented({ label, value, options, onChange }) {
  return <div className="cp-segmented" role="radiogroup" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/**
 * Headline figures in the Studio idiom: one hairline strip, mono labels, display-weight values.
 * `compact` is the same strip at document-header scale.
 */
export function FigureStrip({ figures, compact = false, label }) {
  return <dl className={compact ? "cp-figures cp-figures-compact" : "cp-figures"} aria-label={label}>
    {figures.map(figure => <div key={figure.label} className={figure.hero ? "cp-figure cp-figure-hero" : "cp-figure"}>
      <dt>{figure.label}</dt>
      <dd>
        <strong>{figure.value}</strong>
        {figure.chip ? <span className="status-chip">{figure.chip}</span> : null}
      </dd>
      {figure.trend ? <Sparkline values={figure.trend} label={`${figure.label} trend`} /> : null}
      {figure.detail ? <small>{figure.detail}</small> : null}
    </div>)}
  </dl>;
}

/** A de-emphasised trend line; the latest step carries the accent. */
function Sparkline({ values, label }) {
  const max = Math.max(...values, 0) || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const points = values.map((value, index) => `${index * step},${22 - (value / max) * 20}`);
  return <svg className="cp-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label}>
    <polyline points={points.join(" ")} vectorEffect="non-scaling-stroke" />
    {points.length > 1 ? <polyline className="cp-sparkline-latest" points={points.slice(-2).join(" ")} vectorEffect="non-scaling-stroke" /> : null}
  </svg>;
}

/** 1D/7D/14D/30D presets plus a custom From/To range, shared by both tabs. */
export function RangePicker({ range, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: range.from || TODAY, to: range.to || TODAY });
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (event.key === "Escape" || (event.type === "mousedown" && !ref.current?.contains(event.target))) setOpen(false); };
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("mousedown", close); };
  }, [open]);
  const valid = draft.from && draft.to && draft.from <= draft.to && draft.from >= EARLIEST && draft.to <= TODAY;
  return <div className="cp-range" ref={ref}>
    <div className="cp-segmented" role="radiogroup" aria-label="Date range">
      {PRESETS.map(preset => <button key={preset.value} type="button" role="radio" aria-checked={range.preset === preset.value} onClick={() => { onChange({ preset: preset.value }); setOpen(false); }}>{preset.label}</button>)}
      <button type="button" role="radio" aria-checked={range.preset === "custom"} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        {range.preset === "custom" ? (range.from === range.to ? range.from.slice(5) : `${range.from.slice(5)} – ${range.to.slice(5)}`) : "Custom"}
      </button>
    </div>
    {open ? <form className="cp-range-popover" role="dialog" aria-label="Custom date range" onSubmit={event => { event.preventDefault(); if (valid) { onChange({ preset: "custom", ...draft }); setOpen(false); } }}>
      <label>From<input type="date" value={draft.from} min={EARLIEST} max={TODAY} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>To<input type="date" value={draft.to} min={EARLIEST} max={TODAY} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <p className="cp-muted">{valid ? (draft.from === draft.to ? "One day is shown by hour." : "Shown by day.") : `Choose dates from ${EARLIEST} to ${TODAY}.`}</p>
      <div className="cp-range-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button><button type="submit" disabled={!valid}>Apply</button></div>
    </form> : null}
  </div>;
}
