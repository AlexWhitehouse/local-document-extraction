import React from "react";
import { Tooltip } from "../ui/Tooltip.jsx";
import "./ProcessingCost.css";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

function amountLabel(cost) {
  if (!cost || cost.amount === null || !Number.isFinite(cost.amount)) return "Unavailable";
  const amount = cost.amount > 0 && cost.amount < 0.00000001 ? "<$0.00000001" : dollars.format(cost.amount);

  return `${amount}${cost.complete ? "" : "+"}`;
}

/** The same total and breakdown in document and packet headers; keyboard/touch accessible. */
export function ProcessingCost({ costs, kind = "Document" }) {
  const total = amountLabel(costs?.total);

  return (
    <span className="processing-cost">
      <Tooltip
        placement="bottom"
        className="processing-cost-tooltip"
        content={
          <>
            <div className="processing-cost-heading">
              {kind} model cost <span>USD</span>
            </div>
            <dl>
              {[
                ["split", "Smart split"],
                ["auto_template", "Auto template"],
                ["extraction", "Extraction"],
              ].map(([stage, label]) => (
                <div key={stage}>
                  <dt>{label}</dt>
                  <dd>{amountLabel(costs?.[stage])}</dd>
                </div>
              ))}
              <div className="processing-cost-total">
                <dt>Total</dt>
                <dd>{total}</dd>
              </div>
            </dl>
            {costs?.excluded_pages_cost &&
            (costs.excluded_pages_cost.amount > 0 || !costs.excluded_pages_cost.complete) ? (
              <p>Split includes {amountLabel(costs.excluded_pages_cost)} for excluded pages, kept at packet level.</p>
            ) : null}
            {!costs || !costs.total.complete ? (
              <p>
                {costs?.total.amount != null
                  ? "+ marks a known subtotal. Some call costs are unavailable."
                  : "The endpoint did not report a usable cost, or this work predates cost tracking."}
              </p>
            ) : null}
          </>
        }
      >
        <button type="button" className="processing-cost-trigger" aria-label={`${kind} total cost: ${total}`}>
          <strong>{total}</strong> total cost
        </button>
      </Tooltip>
    </span>
  );
}
