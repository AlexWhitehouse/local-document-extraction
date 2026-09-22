import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

export function TourSpotlight({ step, index, total, canContinue, onNext, onExit, onTargetClick }) {
  const cardRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const callbacks = useRef({ onExit, onTargetClick });
  callbacks.current = { onExit, onTargetClick };

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const card = cardRef.current;
    let target = null;
    let frame;
    let previousLayout = "";
    let restoreInert = () => {};
    let previousDescription;
    function allowed(node) {
      return node instanceof Node && (card.contains(node) || (target?.contains(node) && !(step.exclude && node.closest?.(step.exclude))));
    }
    function focusables() {
      return [...(target ? [target, ...target.querySelectorAll(FOCUSABLE)] : []), ...card.querySelectorAll(FOCUSABLE)]
        .filter((node) => node.matches(FOCUSABLE) && !node.disabled && !node.closest("[inert]") && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
    }
    function guard(event) {
      if (!allowed(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "focusin") card.focus({ preventScroll: true });
        return;
      }
      if (event.type === "click" && target?.contains(event.target) && !event.target.closest(":disabled")) {
        callbacks.current.onTargetClick?.();
      }
    }
    function keyboard(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.onExit();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const nodes = focusables();
        const current = nodes.indexOf(document.activeElement);
        const next = current < 0
          ? event.shiftKey ? nodes.length - 1 : 0
          : (current + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
        (nodes[next] || card).focus({ preventScroll: true });
      } else {
        guard(event);
      }
    }
    function restoreDescription() {
      if (!target) return;
      if (previousDescription === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", previousDescription);
    }
    function makeBackgroundInert() {
      restoreInert();
      const changes = [];
      function visit(parent) {
        for (const child of parent.children) {
          if (child === target || child === card || child.classList.contains("tour-mask")) continue;
          if (child.contains(target) || child.contains(card)) visit(child);
          else if (!child.hasAttribute("inert")) {
            child.setAttribute("inert", "");
            changes.push(child);
          }
        }
      }
      visit(document.body);
      if (target && step.exclude) {
        for (const excluded of target.querySelectorAll(step.exclude)) {
          if (!excluded.hasAttribute("inert")) {
            excluded.setAttribute("inert", "");
            changes.push(excluded);
          }
        }
      }
      restoreInert = () => changes.forEach((node) => node.removeAttribute("inert"));
    }
    function measure() {
      const nextTarget = step.id === "complete" ? null : document.querySelector(`[data-tour="${step.target || step.id}"]`);
      if (nextTarget !== target) {
        restoreDescription();
        target = nextTarget;
        if (target) {
          previousDescription = target.getAttribute("aria-describedby");
          target.setAttribute("aria-describedby", `${previousDescription || ""} tour-description`.trim());
          target.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
        makeBackgroundInert();
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      const rect = target?.getBoundingClientRect();
      const hole = rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height ? {
        left: Math.max(0, rect.left - 5), top: Math.max(0, rect.top - 5),
        right: Math.min(width, rect.right + 5), bottom: Math.min(height, rect.bottom + 5),
      } : null;
      const cardWidth = card.offsetWidth;
      const cardHeight = card.offsetHeight;
      let left = (width - cardWidth) / 2;
      let top = (height - cardHeight) / 2;
      if (hole) {
        if (width - hole.right >= cardWidth + 24) { left = hole.right + 16; top = hole.top; }
        else if (hole.left >= cardWidth + 24) { left = hole.left - cardWidth - 16; top = hole.top; }
        else if (height - hole.bottom >= cardHeight + 24) { left = hole.left; top = hole.bottom + 16; }
        else { left = hole.left; top = hole.top - cardHeight - 16; }
      }
      const value = { hole, width, height, left: Math.max(12, Math.min(left, width - cardWidth - 12)), top: Math.max(12, Math.min(top, height - cardHeight - 12)) };
      const serialized = JSON.stringify(value);
      if (serialized !== previousLayout) { previousLayout = serialized; setLayout(value); }
      frame = requestAnimationFrame(measure);
    }
    const events = ["pointerdown", "click", "dblclick", "contextmenu", "focusin", "submit", "dragover", "drop"];
    events.forEach((name) => document.addEventListener(name, guard, true));
    document.addEventListener("keydown", keyboard, true);
    const observer = new MutationObserver(makeBackgroundInert);
    observer.observe(document.body, { childList: true, subtree: true });
    makeBackgroundInert();
    measure();
    card.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      events.forEach((name) => document.removeEventListener(name, guard, true));
      document.removeEventListener("keydown", keyboard, true);
      restoreInert();
      restoreDescription();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [step]);

  const hole = layout?.hole;
  const maskPath = layout ? `M0 0H${layout.width}V${layout.height}H0Z ${hole ? `M${hole.left} ${hole.top}V${hole.bottom}H${hole.right}V${hole.top}Z` : ""}` : "";
  return createPortal(
    <>
      <svg className="tour-mask" aria-hidden="true" width="100%" height="100%">
        <path d={maskPath} fillRule="evenodd" />
        {hole ? <rect x={hole.left} y={hole.top} width={Math.max(0, hole.right - hole.left)} height={Math.max(0, hole.bottom - hole.top)} rx="6" /> : null}
      </svg>
      <section ref={cardRef} className="tour-popover" role="dialog" aria-labelledby="tour-title" aria-describedby="tour-description" tabIndex={-1}
        style={{ left: layout?.left ?? 12, top: layout?.top ?? 12 }}>
        <div className="tour-progress"><span>STUDIO / GETTING STARTED</span><span>{index + 1} / {total}</span></div>
        <progress max={total} value={index + 1} aria-label="Tour progress" />
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-description">{step.text}</p>
        {step.id !== "complete" && !hole ? <p className="tour-hint">Waiting for this control to appear. You can exit the tour at any time.</p> : null}
        <div className="tour-actions">
          <button type="button" className="ghost" onClick={onExit}>{step.id === "complete" ? "Finish tour" : "Exit tour"}</button>
          {step.check ? <button type="button" disabled={!canContinue} onClick={onNext}>Continue</button> : null}
          {step.click || step.action ? <span className="tour-hint">Use the highlighted control</span> : null}
        </div>
      </section>
    </>, document.body,
  );
}
