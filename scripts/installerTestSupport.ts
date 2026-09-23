/** Drive actual terminal input; process completion and a deadline bound every fixture. */
export async function inTerminal(args: string[], steps: [string, string][], options: { cwd: string; env: Record<string, string>; timeout?: number }) {
  let output = "";
  let offset = 0;
  let step = 0;
  let expired = false;
  const child = Bun.spawn(args, {
    cwd: options.cwd, env: options.env,
    terminal: {
      cols: 140, rows: 40,
      data(terminal, data) {
        output += Buffer.from(data).toString();
        const next = steps[step];
        const index = next ? output.indexOf(next[0], offset) : -1;
        if (next && index !== -1) {
          offset = index + next[0].length;
          step++;
          terminal.write(next[1]);
        }
      },
    },
  });
  const timeout = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, options.timeout ?? 10_000);
  try {
    const code = await child.exited;
    // Drain the final PTY bytes after process exit before closing the terminal.
    await Bun.sleep(30);
    if (expired) throw new Error(`Terminal fixture timed out at question ${step + 1}: ${output.slice(-2000)}`);
    return { code, output, answered: step };
  } finally { clearTimeout(timeout); child.terminal?.close(); }
}
