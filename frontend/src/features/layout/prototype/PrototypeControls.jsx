import React, { useEffect } from "react";
import { VARIANTS } from "./sampleData.js";

export function PrototypeControls({ variant, onChange }) {
  const index = VARIANTS.findIndex(item => item.id === variant.id);
  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey ||
          event.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"], [role="tablist"]')) return;
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      onChange(VARIANTS[(index + (event.key === "ArrowRight" ? 1 : VARIANTS.length - 1)) % VARIANTS.length].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onChange]);
  return <div className="lp-switcher" aria-label="Layout prototype controls">
    <div className="lp-switcher-caption"><span>SELECTED LAYOUTS · SAMPLE DATA</span><strong>{variant.id} <span>—</span> {variant.name}</strong><small>Sample data · changes stay in this preview</small></div>
    <div className="lp-switcher-buttons">
      <button type="button" className="lp-switch-arrow" aria-label="Previous variant" onClick={() => onChange(VARIANTS[(index + VARIANTS.length - 1) % VARIANTS.length].id)}>←</button>
      {["A", "B", "C"].map((group, groupIndex) => <div className="lp-switcher-group" key={group} role="group" aria-label={["Workspaces", "Templates", "Documents"][groupIndex]}>
        <span>{["Workspaces", "Templates", "Documents"][groupIndex]}</span>
        <div>{VARIANTS.filter(item => item.id.startsWith(group)).map(item => <button type="button" key={item.id} aria-label={`${item.id} ${item.name}`} aria-pressed={item.id === variant.id} title={item.idea} onClick={() => onChange(item.id)}>{item.id}</button>)}</div>
      </div>)}
      <button type="button" className="lp-switch-arrow" aria-label="Next variant" onClick={() => onChange(VARIANTS[(index + 1) % VARIANTS.length].id)}>→</button>
    </div>
  </div>;
}
