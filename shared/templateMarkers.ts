/** Linear-time parsing of the markers embedded in table field descriptions. Regex parsing of these markers was super-linear on crafted descriptions. */
export const OBJECT_SCHEMA_START = "[[OBJECT_SCHEMA]]";

export const OBJECT_SCHEMA_END = "[[/OBJECT_SCHEMA]]";

export const OBJECT_GUIDANCE_START = "[[OBJECT_TABLE_GUIDANCE]]";

export const OBJECT_GUIDANCE_END = "[[/OBJECT_TABLE_GUIDANCE]]";

type MarkedBlock = { start: number; end: number; content: string };

const WHITESPACE = /\s/;

function findBlock(text: string, startMarker: string, endMarker: string, from = 0): MarkedBlock | undefined {
  const start = text.indexOf(startMarker, from);

  if (start < 0) return undefined;
  const contentStart = start + startMarker.length;
  const close = text.indexOf(endMarker, contentStart);

  if (close < 0) return undefined;

  return { start, end: close + endMarker.length, content: text.slice(contentStart, close) };
}

/** Trimmed content of the first complete schema block, or undefined when there is none. */
export function readObjectSchemaBlock(description: string): string | undefined {
  return findBlock(description, OBJECT_SCHEMA_START, OBJECT_SCHEMA_END)?.content.trim();
}

/** Remove the first schema block and every guidance block, then trim. */
export function stripObjectMarkers(description: string): string {
  const schema = findBlock(description, OBJECT_SCHEMA_START, OBJECT_SCHEMA_END);
  const text = schema ? description.slice(0, schema.start) + description.slice(schema.end) : description;
  let result = "";
  let cursor = 0;

  for (;;) {
    const guidance = findBlock(text, OBJECT_GUIDANCE_START, OBJECT_GUIDANCE_END, cursor);

    if (!guidance) break;
    result += text.slice(cursor, guidance.start);
    cursor = guidance.end;

    while (cursor < text.length && WHITESPACE.test(text[cursor]!)) cursor += 1;
  }

  return (result + text.slice(cursor)).trim();
}
