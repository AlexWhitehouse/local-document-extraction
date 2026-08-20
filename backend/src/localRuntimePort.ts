export function readLocalRuntimePort(value: string | undefined): number {
  if (!value) {
    return 8787;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }

  return parsed;
}
