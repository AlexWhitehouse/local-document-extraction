import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import "./ScrollArea.css";

// Keep the existing scroll element and semantics; only fade edges with hidden content.
export const ScrollArea = forwardRef(function ScrollArea(
  { as: Element = "div", className = "", children, ...props },
  forwardedRef,
) {
  const ref = useRef(null);
  useImperativeHandle(forwardedRef, () => ref.current, []);

  useLayoutEffect(() => {
    const element = ref.current;

    function updateEdges() {
      const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = element;

      // Allow for fractional scroll positions at the end of a container.
      element.dataset.scrollTop = String(scrollTop > 1);
      element.dataset.scrollBottom = String(scrollHeight - clientHeight - scrollTop > 1);
      element.dataset.scrollLeft = String(scrollLeft > 1);
      element.dataset.scrollRight = String(scrollWidth - clientWidth - scrollLeft > 1);
    }

    // Classic scrollbars take space inside the box; the edge fade stops short of them so they stay solid.
    function measureScrollbars() {
      const { borderLeftWidth, borderRightWidth, borderTopWidth, borderBottomWidth } = getComputedStyle(element);
      const vertical = element.offsetWidth - element.clientWidth - parseFloat(borderLeftWidth) - parseFloat(borderRightWidth);
      const horizontal = element.offsetHeight - element.clientHeight - parseFloat(borderTopWidth) - parseFloat(borderBottomWidth);

      element.style.setProperty("--scrollbar-y", `${Math.max(0, vertical) || 0}px`);
      element.style.setProperty("--scrollbar-x", `${Math.max(0, horizontal) || 0}px`);
    }

    function update() {
      measureScrollbars();
      updateEdges();
    }

    update();
    element.addEventListener("scroll", updateEdges, { passive: true });

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);

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
});
