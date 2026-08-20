export interface IndependentCheck {
  command: string[];
  cwd?: string;
  name: string;
}

export interface IndependentCheckResult extends IndependentCheck {
  exitCode: number;
  output: string;
}

export async function runIndependentChecks(
  checks: IndependentCheck[],
  runCheck: (check: IndependentCheck) => Promise<{ exitCode: number; output: string }>,
) {
  const results = await Promise.all(checks.map(async (check): Promise<IndependentCheckResult> => {
    try {
      return { ...check, ...await runCheck(check) };
    } catch (error) {
      return {
        ...check,
        exitCode: 1,
        output: error instanceof Error ? error.stack ?? error.message : String(error),
      };
    }
  }));
  return {
    exitCode: results.some((result) => result.exitCode !== 0) ? 1 : 0,
    results,
  };
}
