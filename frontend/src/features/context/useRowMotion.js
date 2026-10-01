import { useEffect, useRef, useState } from "react";

const MOTION_MS = 1400;

// Flags context-list rows that arrived, or whose tone changed, after the list
// first had rows, so they can animate once. Rows present on first load stay still.
export function useRowMotion(rows, getKey, getTone = () => "") {
  const seen = useRef(null);
  const timers = useRef(new Set());
  const [motion, setMotion] = useState(() => new Map());

  useEffect(() => {
    if (seen.current === null && !rows.length) return;
    const isBaseline = seen.current === null;
    if (isBaseline) seen.current = new Map();
    const updates = new Map();
    for (const row of rows) {
      const key = getKey(row);
      const tone = getTone(row);
      if (!isBaseline) {
        if (!seen.current.has(key)) updates.set(key, "arrived");
        else if (tone && seen.current.get(key) !== tone) updates.set(key, "changed");
      }
      seen.current.set(key, tone);
    }
    if (!updates.size) return;
    setMotion((current) => new Map([...current, ...updates]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setMotion((current) => {
        const next = new Map(current);
        for (const [key, kind] of updates) if (next.get(key) === kind) next.delete(key);
        return next;
      });
    }, MOTION_MS);
    timers.current.add(timer);
    // Keys and tones are read from rows; the accessors are stable in intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (key) => {
    const kind = motion.get(key);
    return kind ? ` row-${kind}` : "";
  };
}
