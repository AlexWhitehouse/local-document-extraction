import { performance } from "node:perf_hooks";

import { runExtraction, type ModelGatewayConfiguration } from "../src/consumer/modelGateway";
import { encodeModelPayloadBase64 } from "../src/consumer/modelPayloadBase64";

const MEBIBYTE = 1024 * 1024;
const ITERATIONS = 9;

type Sample = {
  durationMs: number;
  rssDeltaBytes: number;
};

console.log(`# Model payload base64 benchmark\n`);
console.log(`- Runtime: Bun ${Bun.version} (${Bun.revision})`);
console.log(`- Platform: ${process.platform} ${process.arch}`);
console.log(`- Iterations: ${ITERATIONS} per encoder after one warm-up\n`);
console.log("| Input | Encoder | Median | Peak RSS delta |");
console.log("| ---: | --- | ---: | ---: |");

for (const sizeMiB of [2, 5, 10]) {
  const bytes = deterministicBytes(sizeMiB * MEBIBYTE);
  for (const [name, encoder] of [
    ["legacy JS + btoa", legacyBase64],
    ["native Buffer", (input: Uint8Array) => encodeModelPayloadBase64(input.buffer)],
  ] as const) {
    encoder(bytes);
    const samples = Array.from({ length: ITERATIONS }, () => measure(() => encoder(bytes)));
    console.log(
      `| ${sizeMiB} MiB | ${name} | ${median(samples.map((sample) => sample.durationMs)).toFixed(2)} ms | ${formatMiB(Math.max(...samples.map((sample) => sample.rssDeltaBytes)))} |`,
    );
  }
}

const concurrency = 4;
const pageSizeMiB = 2;
const pageBytes = deterministicBytes(pageSizeMiB * MEBIBYTE);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ results: [] }) } }],
}), { headers: { "content-type": "application/json" } });

try {
  const gatewaySample = await measureAsync(() => Promise.all(
    Array.from({ length: concurrency }, () =>
      runExtraction(
        gatewayEnvironment(),
        [],
        pageBytes.buffer.slice(0),
        "image/png",
      )
    ),
  ));
  console.log(`\n## Gateway preparation fixture\n`);
  console.log(
    `${concurrency} concurrent ${pageSizeMiB} MiB rendered-page-equivalent image payloads completed in ${gatewaySample.durationMs.toFixed(2)} ms with ${formatMiB(gatewaySample.rssDeltaBytes)} RSS delta.`,
  );
} finally {
  globalThis.fetch = originalFetch;
}

function measure(operation: () => string): Sample {
  Bun.gc(true);
  const baselineRss = process.memoryUsage.rss();
  const startedAt = performance.now();
  const output = operation();
  const durationMs = performance.now() - startedAt;
  const rssDeltaBytes = Math.max(0, process.memoryUsage.rss() - baselineRss);
  if (output.length === 0) process.stderr.write("");
  return { durationMs, rssDeltaBytes };
}

async function measureAsync(operation: () => Promise<unknown>): Promise<Sample> {
  Bun.gc(true);
  const baselineRss = process.memoryUsage.rss();
  const startedAt = performance.now();
  await operation();
  return {
    durationMs: performance.now() - startedAt,
    rssDeltaBytes: Math.max(0, process.memoryUsage.rss() - baselineRss),
  };
}

function deterministicBytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_value, index) => (index * 31 + 17) % 256);
}

function legacyBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function formatMiB(bytes: number): string {
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB`;
}

function gatewayEnvironment(): ModelGatewayConfiguration {
  return {
    AI_MODEL: "benchmark/model",
    LITELLM_KEY: "benchmark-only",
    MODEL_GATEWAY_URL: "https://benchmark.invalid",
  };
}
