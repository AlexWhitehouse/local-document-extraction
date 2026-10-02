export const MAX_TEMPLATE_TAGS = 50;
export const MAX_TEMPLATE_TAG_NAME_LENGTH = 64;

/** Tags are Workspace metadata with a canonical, case-insensitive name. */
export function normalizeTemplateTagName(input: unknown): string {
  if (typeof input !== "string") throw new Error("Tag names must be strings");
  // eslint-disable-next-line no-control-regex -- Tag names explicitly reject control characters before whitespace normalization.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(input)) throw new Error("Tag names must not contain control characters");
  const name = input.trim().replace(/\s+/gu, " ").toLowerCase();
  if (!name) throw new Error("Tag names must not be empty");
  if (Array.from(name).length > MAX_TEMPLATE_TAG_NAME_LENGTH) {
    throw new Error(`Tag names must contain at most ${MAX_TEMPLATE_TAG_NAME_LENGTH} characters`);
  }
  return name;
}

export function normalizeTemplateTags(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Tags must be an array of strings");
  if (input.length > MAX_TEMPLATE_TAGS) throw new Error(`Tags must contain at most ${MAX_TEMPLATE_TAGS} items`);
  return [...new Set(input.map(normalizeTemplateTagName))].sort();
}
