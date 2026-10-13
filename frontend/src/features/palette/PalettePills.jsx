import React from "react";
import { PILL_TYPE_LABELS, pillFamily } from "./paletteState.js";

const UNUSED_NOTE = "Not used. It didn't match an action, template, field or value.";

function bareWord(word) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}@.'-]/gu, "");
}

// One typed pill per phrase; connecting words stay plain. While the request is interpreted
// the pills shimmer; afterwards each shows what it matched after a divider.
export function PalettePills({ segments, labels = [], unused = [], pending = false }) {
  const unusedWords = new Set(unused.flatMap((phrase) => phrase.split(/\s+/).map(bareWord)).filter(Boolean));
  const unusedPhrases = new Set(unused.map((phrase) => phrase.trim().toLowerCase()));
  let order = 0;

  return segments.map((segment, index) => {
    const key = `${segment.start ?? index}-${segment.type}`;

    if (segment.type === "plain") {
      return (
        <React.Fragment key={key}>
          {segment.text.split(/(\s+)/).map((word, position) => {
            if (!word) return null;

            if (!word.trim()) return " ";

            if (!pending && unusedWords.has(bareWord(word))) {
              return (
                <span key={position} className="palette-pill palette-pill-unused" title={UNUSED_NOTE}>
                  {word}
                  <span className="sr-only"> (not used)</span>
                </span>
              );
            }

            return (
              <span key={position} className="palette-plain">
                {word}
              </span>
            );
          })}
        </React.Fragment>
      );
    }

    // A recognised phrase that couldn't be applied is shown as unused too.
    if (!pending && unusedPhrases.has(segment.text.trim().toLowerCase())) {
      return (
        <span key={key} className="palette-pill palette-pill-unused" title={UNUSED_NOTE}>
          {segment.text}
          <span className="sr-only"> (not used)</span>
        </span>
      );
    }

    const typeLabel = PILL_TYPE_LABELS[segment.type] || "Phrase";
    const label = pending ? null : labels[index];
    const delay = order++ * 45;

    return (
      <span
        key={key}
        className={`palette-pill palette-pill-${pillFamily(segment.type)}${pending ? " is-pending" : ""}`}
        style={{ animationDelay: `${delay}ms` }}
        title={label ? `${typeLabel}: ${label}` : typeLabel}
      >
        <span className="sr-only">{typeLabel}: </span>
        {segment.text}
        {label ? (
          <span className="palette-pill-match">
            <span className="sr-only">, matched </span>
            {label}
          </span>
        ) : null}
      </span>
    );
  });
}

// The footer legend: the pill types present in the request.
export function PillLegend({ segments }) {
  const types = [...new Set(segments.flatMap((segment) => (segment.type === "plain" ? [] : [segment.type])))];

  if (!types.length) return null;

  return (
    <span className="palette-legend" aria-label="Pill types">
      {types.map((type) => (
        <span key={type} className={`palette-pill palette-pill-${pillFamily(type)} palette-legend-pill`}>
          {PILL_TYPE_LABELS[type] || type}
        </span>
      ))}
    </span>
  );
}
