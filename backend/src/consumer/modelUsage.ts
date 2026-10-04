export type ModelCallUsage = {
  cost: number | null;
  currency: "USD" | null;
  cost_source: "usage.cost" | "cost_breakdown.total_cost" | "x-litellm-response-cost" | null;
  request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
};

export type ModelCallObserver = {
  started(): string;
  finished(callId: string, usage: ModelCallUsage): void;
};

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const tokens = (value: unknown): number | null => nonnegative(value) && Number.isSafeInteger(value) ? value : null;
const identifier = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;

/** Known USD response conventions. No endpoint hostname or provider selection is needed.
 * A body total wins over a header total; components are never added to a total.
 */
export function readModelCallUsage(body?: unknown, headers = new Headers()): ModelCallUsage {
  const response = record(body), usage = record(response.usage), breakdown = record(response.cost_breakdown);
  const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const result: ModelCallUsage = {
    cost: null, currency: null, cost_source: null,
    request_id: identifier(response.id) ?? identifier(headers.get("x-request-id")) ?? identifier(headers.get("x-requesty-request-id")) ?? identifier(headers.get("x-litellm-call-id")),
    input_tokens: tokens(usage.prompt_tokens ?? usage.input_tokens),
    output_tokens: tokens(usage.completion_tokens ?? usage.output_tokens),
    cached_input_tokens: tokens(details.cached_tokens),
  };
  const currency = usage.currency ?? breakdown.currency ?? response.currency;
  // Never silently combine another currency with the known USD conventions.
  if (currency != null && currency !== "USD") return result;
  const header = headers.get("x-litellm-response-cost");
  const candidates = [
    ["usage.cost", usage.cost],
    ["cost_breakdown.total_cost", breakdown.total_cost],
    ["x-litellm-response-cost", header?.trim() && /^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(header.trim()) ? Number(header) : null],
  ] as const;
  for (const [source, amount] of candidates) {
    if (nonnegative(amount)) return { ...result, cost: amount, currency: "USD", cost_source: source };
  }
  return result;
}
