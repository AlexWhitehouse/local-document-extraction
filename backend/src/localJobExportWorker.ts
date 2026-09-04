import type { buildJobExportWorkbook, JobExportWorkbook } from "./jobExportWorkbook";

export function buildJobExportInWorker(input: Parameters<typeof buildJobExportWorkbook>[0], signal: AbortSignal): Promise<JobExportWorkbook> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./jobExportWorker.ts", import.meta.url).href);
    let settled = false;
    const finish = (error?: Error, result?: JobExportWorkbook) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new Error("Export cancelled"));
    const timer = setTimeout(() => finish(new Error("Export timed out")), 60_000);
    worker.onmessage = (event) => {
      const { result, error } = event.data;
      finish(error ? new Error(error) : undefined, result);
    };
    worker.onerror = () => finish(new Error("Export worker failed"));
    worker.addEventListener("close", () => { if (!settled) finish(new Error("Export worker stopped")); });
    signal.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(input); }
    catch (error) { finish(error as Error); }
  });
}
