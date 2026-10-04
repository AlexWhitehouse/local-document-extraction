import { expect, test } from "bun:test";
import { readModelCallUsage } from "./modelUsage";

test("normalizes Requesty-style usage without a provider or hostname requirement", () => {
  expect(readModelCallUsage({ id: "rqsty-example", usage: {
    cost: 0.0022842, prompt_tokens: 3585, completion_tokens: 443, prompt_tokens_details: { cached_tokens: 384 },
  } })).toEqual({ cost: 0.0022842, currency: "USD", cost_source: "usage.cost", request_id: "rqsty-example", input_tokens: 3585, output_tokens: 443, cached_input_tokens: 384 });
});

test("uses a reported breakdown total without adding overlapping cache components", () => {
  expect(readModelCallUsage({ cost_breakdown: { input_cost: 0.0017925, output_cost: 0.0006645, total_cost: 0.002457, cache_read_cost: 0.000192 } })).toMatchObject({ cost: 0.002457, cost_source: "cost_breakdown.total_cost" });
});

test("selects one total with stable precedence, including a genuine zero", () => {
  const headers = new Headers({ "x-litellm-response-cost": "2.85e-05", "x-litellm-call-id": "header-id" });
  expect(readModelCallUsage(undefined, headers)).toMatchObject({ cost: 0.0000285, currency: "USD", request_id: "header-id" });
  expect(readModelCallUsage({ usage: { cost: 0 }, cost_breakdown: { total_cost: 9 } }, headers)).toMatchObject({ cost: 0, cost_source: "usage.cost" });
  expect(readModelCallUsage({ cost_breakdown: { total_cost: 0.1 } }, headers)).toMatchObject({ cost: 0.1, cost_source: "cost_breakdown.total_cost" });
});

test("missing and invalid costs stay unknown while token usage remains available", () => {
  for (const cost of [null, undefined, "0.1", -1, NaN, Infinity, {}, true]) {
    expect(readModelCallUsage({ usage: { cost, input_tokens: 10, output_tokens: 2 } })).toMatchObject({ cost: null, currency: null, input_tokens: 10, output_tokens: 2 });
  }
  for (const value of ["", " ", "NaN", "Infinity", "-1", "0x10", "null"]) {
    expect(readModelCallUsage({}, new Headers({ "x-litellm-response-cost": value })).cost).toBeNull();
  }
  expect(readModelCallUsage({ usage: { cost: 2, currency: "EUR" } }).cost).toBeNull();
});
