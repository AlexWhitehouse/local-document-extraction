export function disposeRpcResult(result: unknown): void {
  if ((typeof result !== "object" && typeof result !== "function") || result === null) {
    return;
  }

  const symbolDispose = (Symbol as unknown as { dispose?: symbol }).dispose;
  if (symbolDispose) {
    const dispose = (result as Record<symbol, unknown>)[symbolDispose];
    if (typeof dispose === "function") {
      dispose.call(result);
      return;
    }
  }

  const dispose = (result as { dispose?: unknown }).dispose;
  if (typeof dispose === "function") {
    dispose.call(result);
  }
}
