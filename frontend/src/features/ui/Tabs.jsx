import React, { useEffect, useId, useRef } from "react";
import "./Tabs.css";

// Roving focus for a row of options: Arrow keys move, Home/End jump. Returns the
// index to focus, or -1 when the key isn't handled.
function nextIndex(key, index, count, orientation = "horizontal") {
  const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  const backward = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";

  if (key === forward) return (index + 1) % count;

  if (key === backward) return (index - 1 + count) % count;

  if (key === "Home") return 0;

  if (key === "End") return count - 1;

  return -1;
}

function useRovingKeys(items, value, onChange) {
  const refs = useRef([]);

  const onKeyDown = (event, index) => {
    const enabled = items.map((item, position) => (item.disabled ? -1 : position)).filter((position) => position >= 0);
    const at = Math.max(0, enabled.indexOf(index));
    const target = nextIndex(event.key, at, enabled.length);

    if (target < 0) return;

    event.preventDefault();
    const next = enabled[target];
    refs.current[next]?.focus();
    onChange(items[next].value);
  };

  return { refs, onKeyDown, selectedIndex: items.findIndex((item) => item.value === value) };
}

// Tabs switch between panels. Pass `panelId(value)` ids to the panels you render, or
// use `renderPanel` to render the active panel with the right labelling.
// Items may carry a `tone` (neutral | info | success | warning | danger), `busy` (pulses) and
// `loading` (aria-busy) for per-tab progress.
export function Tabs({ label, items, value, onChange, variant = "underline", idPrefix, renderPanel, className }) {
  const generated = useId();
  const prefix = idPrefix || generated;
  const roving = useRovingKeys(items, value, onChange);
  const { refs, onKeyDown } = roving;
  const selectedIndex = Math.max(0, roving.selectedIndex);
  const active = items[selectedIndex];

  // Keep the selected tab in view when the selection changes; "nearest" leaves a tab that is already visible where it is.
  useEffect(() => {
    refs.current[selectedIndex]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [refs, selectedIndex]);

  return (
    <>
      <div className={["ui-tabs", `ui-tabs-${variant}`, className].filter(Boolean).join(" ")} role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const selected = index === selectedIndex;

          return (
            <button
              key={item.value}
              ref={(node) => (refs.current[index] = node)}
              type="button"
              role="tab"
              id={`${prefix}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${prefix}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              aria-busy={item.loading || undefined}
              className={["ui-tab", selected && "is-selected", item.tone && `ui-tone-${item.tone}`, item.busy && "is-busy"]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
              {item.meta ? (
                <span key={String(item.meta)} className="ui-tab-meta">
                  {item.meta}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {renderPanel && active ? (
        <div
          role="tabpanel"
          id={`${prefix}-panel-${active.value}`}
          aria-labelledby={`${prefix}-tab-${active.value}`}
          tabIndex={0}
          className="ui-tabpanel"
        >
          {renderPanel(active.value)}
        </div>
      ) : null}
    </>
  );
}

// A single choice among a few options, as a radio group.
export function Segmented({ label, items, value, onChange, size = "md", className, children }) {
  const { refs, onKeyDown, selectedIndex } = useRovingKeys(items, value, onChange);
  // With nothing selected, the first option takes focus.
  const focusIndex = Math.max(0, selectedIndex);

  return (
    <div
      className={["segmented", size === "sm" && "segmented-sm", className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={label}
    >
      {items.map((item, index) => {
        const selected = index === selectedIndex;

        return (
          <button
            key={item.value}
            ref={(node) => (refs.current[index] = node)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={item.disabled}
            title={item.title}
            className={selected ? "active" : undefined}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}
