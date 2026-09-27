/** Shared by durable Documents and temporary Evaluations. Retry-After remains
 * authoritative; each caller separately bounds its overall operation lifetime. */
export const EXTRACTION_MAX_ATTEMPTS = 3;
export const EXTRACTION_MAX_RETRY_DELAY_MS = 60000;
export function extractionRetryDelay(attempt: number, baseMs: number, retryAfterMs: number | null = 0, maxMs = EXTRACTION_MAX_RETRY_DELAY_MS, random = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(Math.floor(Math.max(0, Math.min(1, random())) * ceiling), retryAfterMs ?? 0);
}
