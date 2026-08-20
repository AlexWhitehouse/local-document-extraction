# CPU Profile

| Duration | Samples | Interval | Functions |
|----------|---------|----------|----------|
| 14.80s | 466 | 1.0ms | 616 |

**Top 10:** `rss` 69.0%, `get` 9.0%, `all` 3.5%, `async (anonymous)` 3.3%, `run` 2.1%, `processTicksAndRejections` 1.4%, `async parseLocalMultipartSubmission` 1.4%, `slice` 1.0%, `_addListener` 1.0%, `anonymous` 0.9%

## Hot Functions (Self Time)

| Self% | Self | Total% | Total | Function | Location |
|------:|-----:|-------:|------:|----------|----------|
| 69.0% | 10.21s | 69.0% | 10.21s | `rss` | `[native code]` |
| 9.0% | 1.33s | 9.0% | 1.33s | `get` | `[native code]` |
| 3.5% | 518.4ms | 3.5% | 518.4ms | `all` | `[native code]` |
| 3.3% | 503.3ms | 3.3% | 503.3ms | `async (anonymous)` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:486` |
| 2.1% | 319.6ms | 2.1% | 319.6ms | `run` | `[native code]` |
| 1.4% | 217.3ms | 23.9% | 3.54s | `processTicksAndRejections` | `[native code]` |
| 1.4% | 211.4ms | 1.4% | 212.9ms | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:141` |
| 1.0% | 160.3ms | 1.0% | 160.3ms | `slice` | `[native code]` |
| 1.0% | 149.2ms | 1.0% | 149.2ms | `_addListener` | `node:events:193` |
| 0.9% | 139.3ms | 6.6% | 981.6ms | `anonymous` | `[native code]` |
| 0.7% | 110.6ms | 0.7% | 110.6ms | `destroyer` | `internal:streams/pipeline:14` |
| 0.6% | 92.3ms | 0.6% | 92.3ms | `mkdir` | `[native code]` |
| 0.5% | 75.4ms | 0.5% | 75.4ms | `loadSystemFonts` | `[native code]` |
| 0.5% | 74.4ms | 0.5% | 74.4ms | `json` | `[native code]` |
| 0.3% | 58.0ms | 0.3% | 58.0ms | `async handleLocalJobRead` | `<repo>/backend/src/localApplication.ts:781` |
| 0.3% | 49.6ms | 0.3% | 49.6ms | `Duplex` | `internal:streams/duplex` |
| 0.2% | 34.4ms | 0.2% | 34.4ms | `input` | `<repo>/node_modules/.bun/@better-auth+core@1.6.23+4c9141cdcc9d04b6/node_modules/@better-auth/core/dist/db/adapter/get-id-field.mjs` |
| 0.2% | 31.6ms | 0.2% | 31.6ms | `normalizeSingle` | `<repo>/backend/src/consumer/modelResultNormalizer.ts:53` |
| 0.2% | 30.7ms | 0.2% | 30.7ms | `Duplex` | `internal:streams/duplex:6` |
| 0.1% | 24.5ms | 1.3% | 198.3ms | `feed` | `<repo>/node_modules/.bun/streamsearch@1.1.0/node_modules/streamsearch/lib/sbmh.js:219` |
| 0.1% | 24.4ms | 0.1% | 24.4ms | `onNativePullFulfilled` | `[native code]` |
| 0.1% | 22.0ms | 0.1% | 22.0ms | `async (anonymous)` | `<repo>/backend/src/localApplication.ts` |
| 0.1% | 17.4ms | 0.1% | 17.4ms | `feed` | `<repo>/node_modules/.bun/streamsearch@1.1.0/node_modules/streamsearch/lib/sbmh.js` |
| 0.1% | 16.8ms | 0.1% | 19.8ms | `onRSDefaultControllerPullFulfilled` | `[native code]` |
| 0.1% | 16.6ms | 0.1% | 16.6ms | `$ZodRegistry` | `<repo>/node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/registries.js:6` |
| 0.1% | 16.5ms | 0.1% | 16.5ms | `newResolvedPromise` | `[native code]` |
| 0.0% | 14.2ms | 0.0% | 14.2ms | `requireNative` | `<repo>/node_modules/.bun/@napi-rs+canvas@1.0.2/node_modules/@napi-rs/canvas/js-binding.js:396` |

## Call Tree (Total Time)

| Total% | Total | Self% | Self | Function | Location |
|-------:|------:|------:|-----:|----------|----------|
| 69.0% | 10.21s | 69.0% | 10.21s | `rss` | `[native code]` |
| 69.0% | 10.21s | 0.0% | 0us | `(anonymous)` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:661` |
| 23.9% | 3.54s | 1.4% | 217.3ms | `processTicksAndRejections` | `[native code]` |
| 20.4% | 3.02s | 0.0% | 9.9ms | `(anonymous)` | `[native code]` |
| 9.0% | 1.33s | 9.0% | 1.33s | `get` | `[native code]` |
| 8.4% | 1.24s | 0.0% | 0us | `async handleLocalJobRead` | `<repo>/backend/src/localApplication.ts:885` |
| 6.6% | 981.6ms | 0.9% | 139.3ms | `anonymous` | `[native code]` |
| 6.3% | 946.3ms | 0.0% | 0us | `bound require` | `[native code]` |
| 6.3% | 934.6ms | 0.0% | 0us | `require` | `[native code]` |
| 4.6% | 686.3ms | 0.0% | 0us | `async fetch` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:485` |
| 3.5% | 518.4ms | 3.5% | 518.4ms | `all` | `[native code]` |
| 3.4% | 517.1ms | 0.0% | 0us | `async handleLocalJobRead` | `<repo>/backend/src/localApplication.ts:900` |
| 3.4% | 515.6ms | 0.0% | 0us | `readExtractionJobResults` | `<repo>/backend/src/localWorkspaceProductStore.ts:954` |
| 3.3% | 503.3ms | 3.3% | 503.3ms | `async (anonymous)` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:486` |
| 3.2% | 480.9ms | 0.0% | 0us | `(anonymous)` | `internal:streams/writable:251` |
| 3.2% | 477.8ms | 0.0% | 1.8ms | `writeOrBuffer` | `internal:streams/writable:285` |
| 3.1% | 472.9ms | 0.0% | 0us | `ondata` | `internal:streams/readable:462` |
| 3.1% | 469.6ms | 0.0% | 0us | `emit` | `node:events:100` |
| 2.1% | 319.6ms | 2.1% | 319.6ms | `run` | `[native code]` |
| 1.7% | 265.8ms | 0.0% | 0us | `flow` | `internal:streams/readable:604` |
| 1.7% | 265.8ms | 0.0% | 0us | `resume_` | `internal:streams/readable:591` |
| 1.7% | 259.8ms | 0.0% | 0us | `(anonymous)` | `internal:streams/readable:376` |
| 1.6% | 246.9ms | 0.0% | 0us | `_write` | `<repo>/node_modules/.bun/busboy@1.6.0/node_modules/busboy/lib/types/multipart.js:567` |
| 1.6% | 246.9ms | 0.0% | 0us | `push` | `<repo>/node_modules/.bun/streamsearch@1.1.0/node_modules/streamsearch/lib/sbmh.js:104` |
| 1.6% | 246.5ms | 0.0% | 0us | `#run` | `bun:sqlite:187` |
| 1.5% | 222.1ms | 0.0% | 0us | `readableAddChunkPushByteMode` | `internal:streams/readable:245` |
| 1.4% | 217.7ms | 0.0% | 0us | `transform` | `<repo>/backend/src/localMultipartSubmission.ts:130` |
| 1.4% | 217.7ms | 0.0% | 0us | `(anonymous)` | `internal:streams/transform:52` |
| 1.4% | 217.7ms | 0.0% | 0us | `addChunk` | `internal:streams/readable:267` |
| 1.4% | 217.7ms | 0.0% | 0us | `(anonymous)` | `internal:streams/transform:58` |
| 1.4% | 212.9ms | 1.4% | 211.4ms | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:141` |
| 1.4% | 208.9ms | 0.0% | 0us | `async (anonymous)` | `<repo>/backend/src/localExtractionRunner.ts:282` |
| 1.3% | 198.3ms | 0.1% | 24.5ms | `feed` | `<repo>/node_modules/.bun/streamsearch@1.1.0/node_modules/streamsearch/lib/sbmh.js:219` |
| 1.3% | 195.8ms | 0.0% | 0us | `transaction` | `bun:sqlite:400` |
| 1.1% | 173.4ms | 0.0% | 0us | `async (anonymous)` | `<repo>/.scratch/high-throughput-local-pdf-extraction/prototype/throughput.ts:529` |
| 1.1% | 173.4ms | 0.0% | 0us | `async (anonymous)` | `<repo>/backend/src/localApplication.ts:100` |
| 1.0% | 160.3ms | 1.0% | 160.3ms | `slice` | `[native code]` |
| 1.0% | 159.0ms | 0.0% | 0us | `Promise` | `[native code]` |
| 1.0% | 158.5ms | 0.0% | 0us | `addListener` | `node:events:214` |
| 1.0% | 153.0ms | 0.0% | 1.6ms | `ssCb` | `<repo>/node_modules/.bun/busboy@1.6.0/node_modules/busboy/lib/types/multipart.js:497` |
| 1.0% | 149.2ms | 1.0% | 149.2ms | `_addListener` | `node:events:193` |
| 1.0% | 149.2ms | 0.0% | 0us | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:76` |
| 0.8% | 129.6ms | 0.0% | 0us | `(anonymous)` | `internal:stream/promises:10` |
| 0.8% | 129.6ms | 0.0% | 0us | `pipeline` | `internal:stream/promises:4` |
| 0.8% | 119.8ms | 0.0% | 0us | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:144` |
| 0.7% | 117.9ms | 0.0% | 0us | `pipelineImpl` | `internal:streams/pipeline:145` |
| 0.7% | 116.9ms | 0.0% | 0us | `forEach` | `[native code]` |
| 0.7% | 116.9ms | 0.0% | 0us | `(anonymous)` | `<repo>/backend/src/localWorkspaceProductStore.ts:728` |
| 0.7% | 116.9ms | 0.0% | 0us | `(anonymous)` | `<repo>/backend/src/localWorkspaceProductStore.ts:727` |
| 0.7% | 110.6ms | 0.7% | 110.6ms | `destroyer` | `internal:streams/pipeline:14` |
| 0.7% | 108.8ms | 0.0% | 0us | `async handleLocalDocumentSubmission` | `<repo>/backend/src/localApplication.ts:636` |
| 0.7% | 108.8ms | 0.0% | 0us | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:43` |
| 0.7% | 108.8ms | 0.0% | 0us | `async parseLocalMultipartSubmission` | `<repo>/backend/src/localMultipartSubmission.ts:27` |
| 0.6% | 92.3ms | 0.0% | 0us | `async mkdir` | `node:fs/promises:247` |
| 0.6% | 92.3ms | 0.6% | 92.3ms | `mkdir` | `[native code]` |
| 0.5% | 85.3ms | 0.0% | 2.0ms | `async handleLocalDocumentSubmission` | `<repo>/backend/src/localApplication.ts:567` |
| 0.5% | 83.2ms | 0.0% | 0us | `async authorizeLocalProductRequest` | `<repo>/backend/src/localApplication.ts:1257` |
---

> Sanitized decision-rich excerpt. The complete native Bun Markdown profile remains in ignored raw scratch state; exhaustive object, edge, string, and function-detail tables are intentionally not copied into agent-facing evidence.
