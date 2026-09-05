import React, { useLayoutEffect, useRef } from "react";
import "./ScrollArea.css";

// Keep the existing scroll element and semantics; only fade edges with hidden content.
export function ScrollArea({
  as: Element = "div",
  className = "",
  children,
  ...props
}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    function updateEdges() {
      const {
        scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth,
      } = element;
      // Allow for fractional scroll positions at the end of a container.
      element.dataset.scrollTop = String(scrollTop > 1);
      element.dataset.scrollBottom = String(scrollHeight - clientHeight - scrollTop > 1);
      element.dataset.scrollLeft = String(scrollLeft > 1);
      element.dataset.scrollRight = String(scrollWidth - clientWidth - scrollLeft > 1);
    }

    updateEdges();
    element.addEventListener("scroll", updateEdges, { passive: true });
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateEdges);
    observer?.observe(element);
    // Content can change height without changing the bounded viewport (or vice versa).
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener("scroll", updateEdges);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <Element ref={ref} className={`scroll-area ${className}`} {...props}>
      {children}
    </Element>
  );
}
