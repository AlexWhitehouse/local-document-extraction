export const benchmarkScenarios = ["explicit", "automatic", "split-explicit", "split-automatic"] as const;
export type BenchmarkScenario = typeof benchmarkScenarios[number];
export type ModelStage = "extraction" | "classification" | "splitting";
export const benchmarkTemplateId = "tpl_loopback_saturation";
export const benchmarkTemplateTag = "loopback";
// This synthetic model name selects named JSON-schema output in the production gateway.
export const benchmarkModelName = "benchmark/qwen3.5-loopback";

export function scenarioWorkload(scenario: BenchmarkScenario, pages: number) {
  const splitting = scenario.startsWith("split-");
  return { splitting, automatic: scenario.endsWith("automatic"), jobsPerSubmission: splitting ? pages : 1 };
}

/** The real gateway request selects the response; unknown contracts fail instead of masking drift. */
export function simulateModelResponse(body: {
  response_format?: { json_schema?: { name?: string } };
  messages?: Array<{ role?: string; content?: unknown }>;
}): { stage: ModelStage; content: string } {
  const name = body.response_format?.json_schema?.name;
  const user = body.messages?.find((message) => message.role === "user");
  const parts = Array.isArray(user?.content) ? user.content as Array<{ type?: string; text?: string }> : [];
  const contextText = parts.find((part) => part.type === "text")?.text;
  if (name === "document_classification") {
    const context = JSON.parse(contextText || "{}") as { candidates?: Array<{ id: string }> };
    if (!context.candidates?.some((candidate) => candidate.id === benchmarkTemplateId)) {
      throw new Error("Classification request is missing the benchmark candidate");
    }
    return { stage: "classification", content: JSON.stringify({
      status: "selected", template_id: benchmarkTemplateId,
      reason: "Synthetic document matches the benchmark reference template.",
      evidence: ["Each fixture page contains a benchmark reference."],
    }) };
  }
  if (name === "document_split") {
    const context = JSON.parse(contextText || "{}") as { pages?: Array<{ original_page: number }> };
    if (!context.pages?.length || context.pages.some((page) => !Number.isSafeInteger(page.original_page))) {
      throw new Error("Split request is missing its original page mapping");
    }
    return { stage: "splitting", content: JSON.stringify({
      status: "resolved", groups: context.pages.map((page) => [page.original_page]), exclusions: [],
      reason: "Each synthetic fixture page is a separate document.",
      evidence: ["Each page starts with its own benchmark reference."],
    }) };
  }
  if (name !== "extraction_results") throw new Error(`Unexpected model response contract: ${name}`);
  return { stage: "extraction", content: JSON.stringify({ results: [{
    field_id: "reference", status: "ok", answer: "LOOPBACK", confidence: 1,
    evidence: "Synthetic loopback benchmark response",
  }] }) };
}

export type TimedOutcome = { status: string; created_at: string; completed_at: string | null };

/** Capacity retries must give the server time to recover before sending another full upload. */
export function submissionRetryDelayMs(retryAfter: string | null, now = Date.now()): number {
  const value = retryAfter?.trim();
  const delay = value && /^\d+$/.test(value)
    ? Number(value) * 1_000
    : value ? Date.parse(value) - now : NaN;
  return Number.isFinite(delay) ? Math.max(1_000, delay) : 1_000;
}

export function summarizeOutcomes(rows: TimedOutcome[], startMs: number, stopMs: number) {
  const completed = rows.filter((row) => row.status === "completed" && row.completed_at);
  const times = completed.map((row) => Date.parse(row.completed_at!)).sort((a, b) => a - b);
  const latency = completed.map((row) => Math.max(0, Date.parse(row.completed_at!) - Date.parse(row.created_at))).sort((a, b) => a - b);
  const failed = rows.filter((row) => row.status === "failed").length;
  const measured = times.filter((time) => time >= startMs && time <= stopMs).length;
  const span = times.length > 1 ? times[times.length - 1]! - times[0]! : 0;
  return {
    completed: completed.length, failed, other: rows.length - completed.length - failed,
    lifecycleP50Ms: latency[Math.max(0, Math.ceil(latency.length * 0.5) - 1)] ?? 0,
    lifecycleP95Ms: latency[Math.max(0, Math.ceil(latency.length * 0.95) - 1)] ?? 0,
    measurementCompleted: measured,
    measurementJobsPerSecond: measured / (Math.max(1, stopMs - startMs) / 1_000),
    completionSpanJobsPerSecond: span > 0 ? (times.length - 1) / (span / 1_000) : 0,
  };
}

/** Completion events precede runner cleanup and permit release. Wait for both before shutdown. */
export async function waitForBenchmarkDrain(
  readProgress: () => Promise<{ terminalJobs: number; active: number; pending: number; deferred: number }>,
  expectedJobs: number,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const progress = await readProgress();
    if (progress.terminalJobs >= expectedJobs && progress.active === 0 && progress.pending === 0 && progress.deferred === 0) return;
    await Bun.sleep(25);
  }
}
