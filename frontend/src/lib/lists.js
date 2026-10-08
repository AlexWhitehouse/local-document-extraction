// Returns a copy with `item` back at `index`. An index past the end appends it.
export function insertAt(list, index, item) {
  const next = [...list];

  next.splice(Math.min(index, next.length), 0, item);

  return next;
}
