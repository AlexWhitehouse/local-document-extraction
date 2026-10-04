import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const measure = () => setWidth(ref.current.getBoundingClientRect().width || fallback);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(ref.current);
    return () => observer?.disconnect();
  }, [fallback]);
  return [ref, width];
}

/** One floating tooltip per chart. Marks call show() on hover and focus. */
export function useChartTip() {
  const [tip, setTip] = useState(null);
  const show = useCallback((event, content) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || rect.left + rect.width / 2;
    const y = event.clientY || rect.top;
    setTip({ x, y, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}
