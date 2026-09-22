import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type Installation = {
  root: string;
  release: string;
  bun: string;
  configFile: string;
  state: string;
  repo: string;
  version: string;
  sha256: string;
};
type Running = { pid: number; server: string; origin: string };
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, contents: string, mode = 0o600) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const descriptor = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    try { await descriptor.writeFile(contents); await descriptor.sync(); } finally { await descriptor.close(); }
    // Replacing a destination symlink changes the link itself, never its target.
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function withManagementLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await privateDirectory(root);
  const lock = join(root, "management.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holder = Number(await readFile(join(lock, "pid"), "utf8").catch(() => "0"));
    if (!holder || processExists(holder)) throw new Error("Another installation/management command holds the installation lock.", { cause: error });
    await rm(lock, { recursive: true });
    await mkdir(lock, { mode: 0o700 });
  }
  await writeFile(join(lock, "pid"), String(process.pid), { mode: 0o600 });
  try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
}

function processExists(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function runningInstallation(root: string): Promise<Running | null> {
  const running = await readFile(join(root, "running.json"), "utf8").then((value) => JSON.parse(value) as Running).catch(() => null);
  if (!running || !Number.isSafeInteger(running.pid) || running.pid < 1 || !processExists(running.pid)) return null;
  const result = spawnSync("ps", ["-ww", "-p", String(running.pid), "-o", "stat=", "-o", "command="], { encoding: "utf8" });
  const processState = result.stdout.trim().split(/\s+/)[0] || "";
  // macOS briefly reports an exiting process with E; Linux/macOS use Z for zombies.
  if (result.status !== 0 || !processState || /[ZEX]/.test(processState)) return null;
  if (!result.stdout.includes(running.server)) throw new Error("Saved process ID belongs to a different process; refusing to signal it. Inspect running.json.");
  return running;
}

export function applicationEnvironment(installation: Installation): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOCUMENT_EXTRACTION_STATE_DIR: installation.state,
    DOCUMENT_EXTRACTION_ASSETS_DIR: join(installation.release, "frontend/dist"),
  };
}

export function runApplicationCommand(installation: Installation, script: string) {
  const result = spawnSync(installation.bun, [`--env-file=${installation.configFile}`, join(installation.release, script)], {
    cwd: installation.release,
    env: applicationEnvironment(installation),
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Application check failed: ${script}`);
}

export async function assertReady(origin: string) {
  const health = await fetch(`${origin}/v1/health`, { redirect: "error", signal: AbortSignal.timeout(3_000) });
  const details = await health.json() as { ok?: boolean; service?: string };
  if (!health.ok || !details.ok || details.service !== "document-extraction-api") throw new Error("Health check failed.");
  const page = await fetch(origin, { redirect: "error", signal: AbortSignal.timeout(3_000) });
  if (!page.ok || !page.headers.get("content-type")?.includes("text/html") || !(await page.text()).includes('id="root"')) {
    throw new Error("Built application page is unavailable.");
  }
}

export async function startInstallation(installation: Installation): Promise<Running> {
  const existing = await runningInstallation(installation.root);
  if (existing) { await assertReady(existing.origin); return existing; }
  runApplicationCommand(installation, "backend/src/checkConfiguration.ts");
  const server = join(installation.release, "backend/src/server.ts");
  const logPath = join(installation.root, "server.log");
  const log = await open(logPath, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(installation.bun, [`--env-file=${installation.configFile}`, server], {
      cwd: installation.release,
      env: applicationEnvironment(installation),
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
  } finally { await log.close(); }
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  let ready: Running | undefined;
  try {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server did not start. Check ${logPath}; another application may already use the configured port.`);
      }
      const logText = await readFile(logPath, "utf8");
      const match = logText.match(/^LOCAL_RUNTIME_READY (.+)$/m);
      if (match) {
        const { origin } = JSON.parse(match[1]!) as { origin: string };
        await assertReady(origin);
        ready = { pid: child.pid!, server, origin };
        await writePrivateFile(join(installation.root, "running.json"), `${JSON.stringify(ready)}\n`);
        child.unref();
        return ready;
      }
      await pause(200);
    }
    throw new Error(`Server readiness timed out. Check ${logPath}.`);
  } finally {
    if (!ready) {
      child.kill("SIGTERM");
      child.unref();
    }
  }
}

export async function stopInstallation(root: string) {
  const running = await runningInstallation(root);
  if (!running) { await rm(join(root, "running.json"), { force: true }); return; }
  process.kill(running.pid, "SIGTERM");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!await runningInstallation(root)) {
      await rm(join(root, "running.json"), { force: true });
      return;
    }
    await pause(200);
  }
  throw new Error("Graceful shutdown is still pending; inspect the server log. No forced shutdown was performed.");
}

async function showMail(installation: Installation) {
  const directory = join(installation.state, "mail");
  const files = (await readdir(directory).catch(() => [])).filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
  const recent = files.slice(-2);
  const lines = (await Promise.all(recent.map((file) => readFile(join(directory, file), "utf8")))).join("\n").split("\n").filter(Boolean).slice(-10);
  if (!lines.length) { console.log("No captured local mail. Sign up first, or check your configured external mailbox."); return; }
  console.log("Recent local mail (private verification/reset links; do not share):");
  for (const line of lines) {
    const record = JSON.parse(line) as { occurred_at: string; to: string; subject: string; action_url?: string };
    console.log(`${record.occurred_at} | ${record.to} | ${record.subject}\n${record.action_url || "No action link"}`);
  }
}

async function manage() {
  const [rootArgument, command = "status", ...args] = process.argv.slice(2);
  if (!rootArgument) throw new Error("Use the installed document-extraction launcher.");
  const root = resolve(rootArgument);
  const installation = JSON.parse(await readFile(join(root, "installation.json"), "utf8")) as Installation;
  if ((command === "start" || command === "doctor") && await Bun.file(join(root, "upgrade-incomplete.json")).exists()) {
    throw new Error("An installation failed after migration began. Retry installation or restore the documented backup before starting an older release.");
  }
  if (command === "update") {
    if (args.length > 1 || (args[0] && !/^[A-Za-z0-9_.-]+$/.test(args[0]))) throw new Error("Usage: document-extraction update [release-tag]");
    if (await runningInstallation(root)) throw new Error("Stop the application before updating: document-extraction stop");
    const result = spawnSync("bash", [join(installation.release, "scripts/install.sh"), "--repo", installation.repo, "--version", args[0] || "latest", "--install-dir", root, "--config-dir", resolve(installation.configFile, ".."), "--state-dir", installation.state], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return;
  }
  await withManagementLock(root, async () => {
    switch (command) {
      case "start": console.log(`Application ready: ${(await startInstallation(installation)).origin}`); break;
      case "stop": await stopInstallation(root); console.log("Application stopped."); break;
      case "status": {
        const running = await runningInstallation(root);
        if (running) console.log(`Running: ${running.origin} (PID ${running.pid})`);
        else { console.log("Application stopped."); process.exitCode = 3; }
        break;
      }
      case "doctor": {
        runApplicationCommand(installation, "backend/src/checkConfiguration.ts");
        runApplicationCommand(installation, "scripts/nativeSmoke.ts");
        const running = await runningInstallation(root);
        if (running) await assertReady(running.origin);
        console.log(`Installation checks passed. Application ${running ? "running" : "stopped"}.\nConfig: ${installation.configFile}\nState: ${installation.state}`);
        break;
      }
      case "mail": await showMail(installation); break;
      default: throw new Error("Commands: start, stop, status, doctor, mail, update [release-tag]");
    }
  });
}

if (import.meta.main) {
  try { await manage(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
