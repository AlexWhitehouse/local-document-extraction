import { afterEach, expect, test } from "bun:test";
import { runExtraction, runViaModelGateway, type ModelGatewayConfiguration } from "./modelGateway";
import type { ModelCallUsage } from "./modelUsage";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function gateway(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  cleanups.push(() => server.stop(true));
  const receipts: ModelCallUsage[] = [];
  let started = 0;
  const configuration: ModelGatewayConfiguration = {
    AI_MODEL: "any-model", MODEL_GATEWAY_URL: server.url.toString(), LITELLM_KEY: "dummy",
    modelCallObserver: { started: () => String(++started), finished: (_id, usage) => { receipts.push(usage); } },
  };
  return { configuration, receipts, get started() { return started; } };
}

test("records cost before invalid model content can cause an extraction retry", async () => {
  const g = gateway(() => Response.json({ usage: { cost: 0.003 }, choices: [{ message: { content: "invalid JSON" } }] }));
  await expect(runExtraction(g.configuration, [{ id: "total", name: "Total", description: "Total", data_type: "number" }], new Uint8Array([1]).buffer, "image/png")).rejects.toThrow("not valid JSON");
  expect(g.started).toBe(1);
  expect(g.receipts).toHaveLength(1);
  expect(g.receipts[0]?.cost).toBe(0.003);
});

test("captures an error response cost header without reading its sensitive body", async () => {
  const g = gateway(() => new Response("PRIVATE UPSTREAM ERROR", { status: 503, headers: { "x-litellm-response-cost": "0.002" } }));
  await expect(runViaModelGateway(g.configuration, "{}")).rejects.toThrow("HTTP 503");
  expect(g.receipts[0]?.cost).toBe(0.002);
});

test("an interrupted request finalizes an unknown receipt", async () => {
  const g = gateway(() => new Response("bad gateway", { status: 502 }));
  g.configuration.MODEL_GATEWAY_URL = "http://127.0.0.1:1";
  await expect(runViaModelGateway(g.configuration, "{}")).rejects.toThrow();
  expect(g.started).toBe(1);
  expect(g.receipts[0]?.cost).toBeNull();
});

test("accounting failures after a response do not cause another billable request", async () => {
  let requests = 0;
  const g = gateway(() => { requests++; return Response.json({ usage: { cost: 0 } }); });
  g.configuration.modelCallObserver!.finished = () => { throw new Error("database busy"); };
  expect(await runViaModelGateway(g.configuration, "{}")).toEqual({ usage: { cost: 0 } });
  expect(requests).toBe(1);
  g.configuration.modelCallObserver!.started = () => { throw new Error("database busy"); };
  await expect(runViaModelGateway(g.configuration, "{}")).rejects.toThrow("accounting");
  expect(requests).toBe(1);
});
