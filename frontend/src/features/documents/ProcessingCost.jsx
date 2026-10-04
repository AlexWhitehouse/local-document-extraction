import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProcessingCost.css";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 8 });
function amountLabel(cost) {
  if (!cost || cost.amount === null || !Number.isFinite(cost.amount)) return "Unavailable";
  const amount = cost.amount > 0 && cost.amount < 0.00000001 ? "<$0.00000001" : dollars.format(cost.amount);
  return `${amount}${cost.complete ? "" : "+"}`;
}

/** The same total and breakdown in document and packet headers; keyboard/touch accessible. */
export function ProcessingCost({ costs, kind = "Document" }) {
  const id = useId();
  const trigger = useRef(null);
  const tooltip = useRef(null);
  const timer = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (document.activeElement !== trigger.current) setOpen(false); }, 100); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => { if (event.key === "Escape") { clearTimeout(timer.current); setOpen(false); } };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = tooltip.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      setPosition({
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
        top: Math.max(8, anchor.bottom + box.height + 8 > window.innerHeight ? anchor.top - box.height - 8 : anchor.bottom + 8),
      });
    };
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(document.documentElement);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, costs]);

  const total = amountLabel(costs?.total);
  return <span className="processing-cost" onMouseEnter={show} onMouseLeave={hide}>
    <button ref={trigger} type="button" className="processing-cost-trigger"
      aria-label={`${kind} total cost: ${total}`} aria-describedby={open ? id : undefined}
      onFocus={show} onBlur={() => setOpen(false)}
      onClick={show}>
      <strong>{total}</strong> total cost
    </button>
    {open ? createPortal(<div ref={tooltip} id={id} role="tooltip" className="processing-cost-tooltip"
      style={{ ...position, left: `clamp(8px, ${position.left}px, calc(100vw - 300px))` }}
      onMouseEnter={show} onMouseLeave={hide}>
      <div className="processing-cost-heading">{kind} model cost <span>USD</span></div>
      <dl>
        {[["split", "Smart split"], ["auto_template", "Auto template"], ["extraction", "Extraction"]].map(([stage, label]) => (
          <div key={stage}><dt>{label}</dt><dd>{amountLabel(costs?.[stage])}</dd></div>
        ))}
        <div className="processing-cost-total"><dt>Total</dt><dd>{total}</dd></div>
      </dl>
      {costs?.excluded_pages_cost && (costs.excluded_pages_cost.amount > 0 || !costs.excluded_pages_cost.complete) ? (
        <p>Split includes {amountLabel(costs.excluded_pages_cost)} for excluded pages, kept at packet level.</p>
      ) : null}
      {!costs || !costs.total.complete ? <p>{costs?.total.amount != null ? "+ marks a known subtotal. Some call costs are unavailable." : "The endpoint did not report a usable cost, or this work predates cost tracking."}</p> : null}
    </div>, document.body) : null}
  </span>;
}
