import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inTerminal } from "./installerTestSupport";
import { Database } from "bun:sqlite";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLocalWorkspaceControl } from "../backend/src/localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "../backend/src/localWorkspaceProductStore";
import { createWorkspaceCredentialVault } from "../backend/src/workspaceModelConfiguration";

const repository = resolve(import.meta.dir, "..");
let temporary: string;
let archive: string;
let checksum: string;
let root: string;
let state: string;
let config: string;
let launcher: string;
let path = process.env.PATH || "/usr/bin:/bin";
type Result = { code: number; output: string };

async function command(args: string[], extra: Record<string, string> = {}): Promise<Result> {
  const child = Bun.spawn(args, {
    cwd: repository,
    env: { HOME: process.env.HOME!, PATH: path, TMPDIR: tmpdir(), PORT: "0", ...extra },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output: stdout + stderr };
}
function passed(result: Result) {
  if (result.code !== 0) throw new Error(`Command exited ${result.code}:\n${result.output.slice(-6000)}`);
}
async function install(extra: string[] = [], environment: Record<string, string> = {}) {
  return command(["bash", join(repository, "scripts/install.sh"), "--archive", archive, "--sha256", checksum,
    "--install-dir", root, "--config-dir", config, "--state-dir", state, ...extra], environment);
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "document extraction installer "));
  root = join(temporary, "application with spaces");
  config = join(temporary, "configuration with spaces");
  state = join(temporary, "state with spaces");
  launcher = join(root, "document-extraction");
  const output = join(temporary, "release");
  passed(await command([process.execPath, "--no-env-file", join(repository, "scripts/packageRelease.ts"), "--output", output]));
  archive = join(output, "document-extraction.tar.gz");
  checksum = (await readFile(`${archive}.sha256`, "utf8")).split(" ")[0]!;
}, 30_000);

afterAll(async () => {
  if (launcher && await Bun.file(launcher).exists()) await command([launcher, "stop"]);
  if (temporary) await rm(temporary, { recursive: true, force: true });
}, 40_000);

describe("macOS/Linux release installer", () => {
  test("installs a clean release, renders a PDF, starts the SPA and protects persistent files", async () => {
    passed(await install());
    const metadata = JSON.parse(await readFile(join(root, "installation.json"), "utf8"));
    const running = JSON.parse(await readFile(join(root, "running.json"), "utf8"));
    const response = await fetch(`${running.origin}/v1/health`);
    expect((await response.json() as { ok: boolean }).ok).toBe(true);
    expect(await (await fetch(running.origin)).text()).toContain('id="root"');
    expect(await (await fetch(`${running.origin}/v1/config`)).json()).toMatchObject({ auth: { requireEmailVerification: false } });
    const signup = await fetch(`${running.origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: running.origin },
      body: JSON.stringify({ email: "installer@example.test", name: "Installer test", password: "Strong1!" }),
    });
    expect(signup.ok).toBe(true);
    const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).not.toBe("");
    const workspaces = await fetch(`${running.origin}/v1/workspaces`, { headers: { cookie } });
    expect(workspaces.status).toBe(200);
    expect(await workspaces.json()).toMatchObject({ workspaces: [expect.objectContaining({ role: "owner" })] });
    expect(await readdir(join(state, "mail"))).toEqual([]);
    // Request an optional link explicitly so backup/restore still verifies signed-token preservation.
    const verification = await fetch(`${running.origin}/api/auth/send-verification-email`, {
      method: "POST", headers: { "content-type": "application/json", origin: running.origin },
      body: JSON.stringify({ email: "installer@example.test", callbackURL: "/" }),
    });
    expect(verification.ok).toBe(true);
    expect((await stat(state)).mode & 0o777).toBe(0o700);
    expect((await stat(join(config, "config.env"))).mode & 0o777).toBe(0o600);
    passed(await command([launcher, "doctor"]));
    passed(await command([launcher, "mail"]));
    path = `${join(metadata.bun, "..")}:/usr/bin:/bin:/usr/sbin:/sbin`;
    const pinned = JSON.parse(await readFile(join(repository, "package.json"), "utf8")).packageManager.slice(4);
    expect((await command([metadata.bun, "--version"])).output.trim()).toBe(pinned);
    passed(await command([metadata.bun, "run", "--cwd", metadata.release, "typecheck"]));
    passed(await command([metadata.bun, "run", "--cwd", metadata.release, "lint"]));
  }, 180_000);

  test("interactive install saves provider settings privately and upgrades preserve them", async () => {
    const fixture = join(temporary, "interactive");
    const installRoot = join(fixture, "app");
    const configRoot = join(fixture, "config");
    const installedLauncher = join(installRoot, "document-extraction");
    const args = ["bash", join(repository, "scripts/install.sh"), "--archive", archive, "--sha256", checksum,
      "--install-dir", installRoot, "--config-dir", configRoot, "--state-dir", join(fixture, "state"), "--no-start", "--interactive"];
    const googleSecret = "synthetic-google-$HOME-secret";
    const emailToken = "synthetic-email-$PATH-token";
    try {
      const result = await inTerminal(args, [
        ["reverse proxy? [y/N]: ", "y\n"], ["Public app URL (for example https://documents.example.com): ", "https://docs.example.com\n"],
        ["Google sign-in? [y/N]: ", "y\n"], ["Google client ID: ", "synthetic-client\n"],
        ["Google client secret (hidden): ", `${googleSecret}\n`], ["email and password login? [Y/n]: ", "y\n"],
        ["with Cloudflare? [y/N]: ", "y\n"], ["Cloudflare account ID: ", `${"a".repeat(32)}\n`],
        ["Cloudflare Email API token (hidden): ", `${emailToken}\n`],
        ["From email address (on your onboarded domain): ", "sender@example.com\n"], ["From name [Document Extraction]: ", "Installer Test\n"],
        ["email and password? [Y/n]: ", "y\n"],
      ], { cwd: repository, env: { HOME: process.env.HOME!, PATH: path, TMPDIR: tmpdir(), PORT: "0", TERM: "xterm" }, timeout: 120_000 });
      passed(result);
      expect(result.answered).toBe(12);
      expect(result.output).not.toContain(googleSecret);
      expect(result.output).not.toContain(emailToken);
      const savedPath = join(configRoot, "config.env");
      const saved = await readFile(savedPath, "utf8");
      expect((await stat(savedPath)).mode & 0o777).toBe(0o600);
      const metadata = JSON.parse(await readFile(join(installRoot, "installation.json"), "utf8"));
      const configuration = await command([metadata.bun, `--env-file=${savedPath}`, "-e",
        `import {readLocalConfiguration} from ${JSON.stringify(join(metadata.release, "backend/src/localConfiguration.ts"))}; const c=readLocalConfiguration(); console.log(JSON.stringify({origin:c.auth.baseURL,google:c.auth.googleEnabled,verify:c.auth.requireEmailVerification,provider:c.email.provider,secret:process.env.GOOGLE_CLIENT_SECRET,token:process.env.CLOUDFLARE_EMAIL_API_TOKEN}));`]);
      passed(configuration);
      expect(JSON.parse(configuration.output)).toEqual({ origin: "https://docs.example.com", google: true, verify: true, provider: "cloudflare", secret: googleSecret, token: emailToken });
      // Even --interactive on a piped upgrade skips the wizard when config already exists.
      const upgraded = await command(args);
      passed(upgraded);
      expect(upgraded.output).toContain("setup questions are skipped on upgrades");
      expect(await readFile(savedPath, "utf8")).toBe(saved);
    } finally { if (await Bun.file(installedLauncher).exists()) await command([installedLauncher, "stop"]); }
  }, 180_000);

  test("refuses to upgrade a running instance", async () => {
    const before = await readFile(join(root, "installation.json"), "utf8");
    const result = await install();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Stop the installed application");
    expect(await readFile(join(root, "installation.json"), "utf8")).toBe(before);
    passed(await command([launcher, "stop"]));
  }, 60_000);

  test("waits for a signalled process even when its command text disappears during shutdown", async () => {
    const fixture = join(temporary, "shutdown transition");
    const shimDirectory = join(fixture, "bin");
    await mkdir(shimDirectory, { recursive: true });
    const server = join(fixture, "delayed-exit.ts");
    const ready = join(fixture, "ready");
    const signalled = join(fixture, "signalled");
    const observations = join(fixture, "ps-count");
    const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(server, `process.on("SIGTERM", () => { Bun.write(${JSON.stringify(signalled)}, "yes"); setTimeout(() => process.exit(0), 1000); });\nawait Bun.write(${JSON.stringify(ready)}, "yes");\nsetInterval(() => {}, 100);\n`);
    const child = Bun.spawn([process.execPath, "--no-env-file", server], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    try {
      for (let attempt = 0; attempt < 100 && !await Bun.file(ready).exists(); attempt += 1) await Bun.sleep(20);
      expect(await Bun.file(ready).exists()).toBe(true);
      await writeFile(join(fixture, "running.json"), JSON.stringify({ pid: child.pid, server, origin: "http://127.0.0.1:1" }));
      await writeFile(join(shimDirectory, "ps"), `#!/bin/sh
set -eu
count=0
if [ -f ${shellQuote(observations)} ]; then count=$(cat ${shellQuote(observations)}); fi
count=$((count + 1))
printf '%s' "$count" > ${shellQuote(observations)}
if [ "$count" = 2 ]; then printf 'S [bun]\\n'; else exec /bin/ps "$@"; fi
`, { mode: 0o700 });
      const stopScript = join(fixture, "stop.ts");
      await writeFile(stopScript, `import { stopInstallation } from ${JSON.stringify(join(repository, "scripts/manageInstallation.ts"))};\nawait stopInstallation(${JSON.stringify(fixture)});\n`);
      passed(await command([process.execPath, "--no-env-file", stopScript], { PATH: `${shimDirectory}:${path}` }));
      expect(await Bun.file(signalled).exists()).toBe(true);
      expect(Number(await readFile(observations, "utf8"))).toBeGreaterThanOrEqual(2);
      expect(await child.exited).toBe(0);
      expect(await Bun.file(join(fixture, "running.json")).exists()).toBe(false);
    } finally { child.kill("SIGKILL"); await child.exited; }
  }, 15_000);

  test("rejects broad, overlapping and symlink-disguised paths before changing their permissions", async () => {
    const homeMode = (await stat(process.env.HOME!)).mode;
    const sharedMode = (await stat(temporary)).mode;
    const alias = join(temporary, "home-alias");
    await symlink(process.env.HOME!, alias);
    for (const options of [
      ["--install-dir", "/"], ["--config-dir", process.env.HOME!], ["--state-dir", tmpdir()],
      ["--config-dir", alias], ["--config-dir", temporary], ["--state-dir", join(root, "nested-state")],
    ]) {
      const result = await install(options);
      expect(result.code).not.toBe(0);
      expect(result.output).toMatch(/dedicated|non-overlapping/);
    }
    expect((await stat(process.env.HOME!)).mode).toBe(homeMode);
    expect((await stat(temporary)).mode).toBe(sharedMode);
  }, 60_000);

  test("rejects linked and nonregular config files without changing an outside file", async () => {
    const target = join(temporary, "outside-config.env");
    await writeFile(target, "outside configuration must stay unchanged", { mode: 0o644 });
    const targetMode = (await stat(target)).mode;
    const configFile = join(config, "config.env");
    const savedConfig = join(config, "saved-config.env");
    await rename(configFile, savedConfig);
    try {
      await symlink(target, configFile);
      const linked = await install();
      expect(linked.code).not.toBe(0);
      expect(linked.output).toContain("must not be symbolic links");
      expect(await readFile(target, "utf8")).toBe("outside configuration must stay unchanged");
      expect((await stat(target)).mode).toBe(targetMode);
      await rm(configFile);
      await mkdir(configFile, { mode: 0o755 });
      const directoryMode = (await stat(configFile)).mode;
      const directory = await install();
      expect(directory.code).not.toBe(0);
      expect(directory.output).toContain("config.env must be a regular file");
      expect((await stat(configFile)).mode).toBe(directoryMode);
    } finally {
      await rm(configFile, { force: true, recursive: true });
      await rename(savedConfig, configFile);
    }
  }, 60_000);

  test("preserves config and state, backs up before migration, and can leave the app stopped", async () => {
    const configFile = join(config, "config.env");
    await writeFile(configFile, (await readFile(configFile, "utf8")).replace("AUTH_REQUIRE_EMAIL_VERIFICATION=false", "AUTH_REQUIRE_EMAIL_VERIFICATION=true"));
    await appendFile(join(config, "config.env"), "\n# preserved custom configuration\n");
    await writeFile(join(state, "operator-marker"), "preserve me");
    const original = await readFile(join(config, "config.env"), "utf8");
    const authSecret = await readFile(join(state, "data/better-auth-secret"), "utf8");
    const control = new Database(join(state, "data/control.sqlite"));
    let workspaceId: string;
    try {
      const account = control.query('SELECT id FROM "user" WHERE email = ?').get("installer@example.test") as { id: string };
      workspaceId = createLocalWorkspaceControl(control).createWorkspace({ userId: account.id, name: "Backup preservation" }).workspace_id;
    } finally { control.close(); }
    const credential = "installer-backup-dummy-credential";
    const productStore = createLocalWorkspaceProductStore({ stateDirectory: state, workspaceId });
    try {
      const vault = createWorkspaceCredentialVault(state);
      const saved = productStore.putModelConfiguration({
        expectedRevision: null,
        configuration: {
          gateway_url: "http://127.0.0.1:1/v1", model_name: "installer/test-model",
          credential_ciphertext: vault.encrypt(workspaceId, credential),
          sequential_calls: false, supports_pdf_input: false, supports_structured_output: false,
        },
        updatedAt: new Date().toISOString(),
      });
      expect(saved).not.toBeNull();
      expect(saved!.credential_ciphertext).not.toContain(credential);
    } finally { productStore.close(); }
    const modelSecret = await readFile(join(state, "secrets/model-gateway.key"));
    const mailFiles = (await readdir(join(state, "mail"))).filter((file) => file.endsWith(".jsonl")).sort();
    const mail = (await readFile(join(state, "mail", mailFiles.at(-1)!), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { to: string; action_url?: string })
      .find((entry) => entry.to === "installer@example.test" && entry.action_url);
    expect(mail?.action_url).toBeTruthy();
    passed(await install(["--no-start"]));
    expect(await readFile(join(config, "config.env"), "utf8")).toBe(original);
    expect(await readFile(join(state, "operator-marker"), "utf8")).toBe("preserve me");
    expect(await readFile(join(state, "data/better-auth-secret"), "utf8")).toBe(authSecret);
    expect((await readFile(join(state, "secrets/model-gateway.key"))).equals(modelSecret)).toBe(true);
    const upgradedStore = createLocalWorkspaceProductStore({ stateDirectory: state, workspaceId });
    try {
      const saved = upgradedStore.getModelConfiguration();
      expect(saved).not.toBeNull();
      expect(createWorkspaceCredentialVault(state).decrypt(workspaceId, saved!.credential_ciphertext)).toBe(credential);
    } finally { upgradedStore.close(); }
    const database = new Database(join(state, "data/control.sqlite"), { readonly: true });
    try { expect(database.query('SELECT email FROM "user" WHERE email = ?').get("installer@example.test")).toEqual({ email: "installer@example.test" }); }
    finally { database.close(); }
    const backups = await readdir(join(root, "backups"));
    expect(backups.length).toBeGreaterThan(0);
    expect(await readFile(join(root, "backups", backups[0]!, "operator-marker"), "utf8")).toBe("preserve me");
    expect((await command([launcher, "status"])).code).toBe(3);

    const restoredState = join(temporary, "restored backup state");
    await cp(join(root, "backups", backups[0]!), restoredState, { recursive: true, errorOnExist: true, force: false });
    const installed = JSON.parse(await readFile(join(root, "installation.json"), "utf8"));
    const restored = { ...installed, root: join(temporary, "restored runtime"), state: restoredState };
    const restoreScript = join(temporary, "verify-restored-backup.ts");
    await writeFile(restoreScript, `
import { privateDirectory, runApplicationCommand, startInstallation, stopInstallation } from ${JSON.stringify(join(installed.release, "scripts/manageInstallation.ts"))};
import { createLocalWorkspaceProductStore } from ${JSON.stringify(join(installed.release, "backend/src/localWorkspaceProductStore.ts"))};
import { createWorkspaceCredentialVault } from ${JSON.stringify(join(installed.release, "backend/src/workspaceModelConfiguration.ts"))};
const installation = ${JSON.stringify(restored)};
await privateDirectory(installation.root);
runApplicationCommand(installation, "backend/src/migrate.ts");
const store = createLocalWorkspaceProductStore({ stateDirectory: installation.state, workspaceId: ${JSON.stringify(workspaceId)} });
try {
  const saved = store.getModelConfiguration();
  if (!saved || createWorkspaceCredentialVault(installation.state).decrypt(${JSON.stringify(workspaceId)}, saved.credential_ciphertext) !== ${JSON.stringify(credential)}) throw new Error("Restored gateway credential is unusable.");
} finally { store.close(); }
try {
  const { origin } = await startInstallation(installation);
  const originalVerification = new URL(${JSON.stringify(mail!.action_url)});
  const verified = await fetch(origin + originalVerification.pathname + originalVerification.search, { redirect: "manual" });
  if (verified.status !== 302) throw new Error("The original account verification token is unusable after restore.");
  const signIn = await fetch(origin + "/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: "installer@example.test", password: "Strong1!" }),
  });
  if (!signIn.ok) throw new Error("The restored account cannot sign in with its original password.");
  console.log("RESTORED_BACKUP_VERIFIED");
} finally { await stopInstallation(installation.root); }
`);
    const restoredResult = await command([installed.bun, "--no-env-file", restoreScript]);
    passed(restoredResult);
    expect(restoredResult.output).toContain("RESTORED_BACKUP_VERIFIED");
    expect(await readFile(join(restoredState, "data/better-auth-secret"), "utf8")).toBe(authSecret);
    expect((await readFile(join(restoredState, "secrets/model-gateway.key"))).equals(modelSecret)).toBe(true);
  }, 180_000);

  test("rejects checksum and download failures without changing the active installation", async () => {
    const before = await readFile(join(root, "installation.json"), "utf8");
    expect((await install(["--sha256", "0".repeat(64)])).code).not.toBe(0);
    const missing = await command(["bash", join(repository, "scripts/install.sh"), "--repo", "document-extraction-installer-test/missing-repository", "--install-dir", root]);
    expect(missing.code).not.toBe(0);
    expect(await readFile(join(root, "installation.json"), "utf8")).toBe(before);
  }, 60_000);

  test("does not select or migrate a release whose build fails", async () => {
    const before = await readFile(join(root, "installation.json"), "utf8");
    const broken = join(temporary, "broken-source");
    passed(await command(["mkdir", "-p", broken]));
    passed(await command(["tar", "-xzf", archive, "-C", broken]));
    const manifest = JSON.parse(await readFile(join(broken, "package.json"), "utf8"));
    manifest.scripts.build = "bun -e 'process.exit(42)'";
    await writeFile(join(broken, "package.json"), JSON.stringify(manifest));
    const brokenArchive = join(temporary, "broken.tar.gz");
    passed(await command(["tar", "-czf", brokenArchive, "-C", broken, "."], { COPYFILE_DISABLE: "1" }));
    const hash = new Bun.CryptoHasher("sha256").update(await readFile(brokenArchive)).digest("hex");
    const result = await install(["--archive", brokenArchive, "--sha256", hash]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Installation command failed: bun run build");
    expect(await readFile(join(root, "installation.json"), "utf8")).toBe(before);
    expect(await Bun.file(join(root, "upgrade-incomplete.json")).exists()).toBe(false);
  }, 180_000);

  test("detects occupied ports and blocks unsafe old-release startup after migration", async () => {
    const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") });
    try {
      const result = await install(["--no-start"], { PORT: String(occupied.port) });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("another application may already use");
      expect(await Bun.file(join(root, "upgrade-incomplete.json")).exists()).toBe(true);
      expect((await command([launcher, "start"])).code).not.toBe(0);
    } finally { await occupied.stop(true); }
    passed(await install(["--no-start"]));
    expect(await Bun.file(join(root, "upgrade-incomplete.json")).exists()).toBe(false);
    passed(await command([launcher, "start"]));
    passed(await command([launcher, "stop"]));
  }, 180_000);

  test("downloads a fork release and updates using its saved repository without losing private state", async () => {
    const shimDirectory = join(temporary, "download fixture bin");
    const requests = join(temporary, "download requests.txt");
    await mkdir(shimDirectory);
    const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    // Exercise the production HTTPS URL selection unchanged; only curl's transport
    // is replaced. Unknown URLs fail, including an accidental upstream/default repo.
    await writeFile(join(shimDirectory, "curl"), `#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    https://*) url=$1 ;;
    -o) shift; output=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" >> ${shellQuote(requests)}
case "$url" in
  https://github.com/installer-fixture/public-fork/releases/download/v1.2.3/document-extraction.tar.gz|https://github.com/installer-fixture/public-fork/releases/download/v1.2.4/document-extraction.tar.gz)
    cp ${shellQuote(archive)} "$output" ;;
  https://github.com/installer-fixture/public-fork/releases/download/v1.2.3/document-extraction.tar.gz.sha256|https://github.com/installer-fixture/public-fork/releases/download/v1.2.4/document-extraction.tar.gz.sha256)
    cp ${shellQuote(`${archive}.sha256`)} "$output" ;;
  *) printf 'Unexpected download URL: %s\\n' "$url" >&2; exit 22 ;;
esac
`, { mode: 0o700 });
    const environment = { PATH: `${shimDirectory}:${path}` };
    const originalConfig = await readFile(join(config, "config.env"), "utf8");
    const originalSecret = await readFile(join(state, "data/better-auth-secret"), "utf8");
    passed(await command(["bash", join(repository, "scripts/install.sh"),
      "--repo", "installer-fixture/public-fork", "--version", "v1.2.3", "--install-dir", root,
      "--config-dir", config, "--state-dir", state, "--no-start"], environment));
    const installed = JSON.parse(await readFile(join(root, "installation.json"), "utf8"));
    expect(installed.repo).toBe("installer-fixture/public-fork");
    expect(installed.version).toBe("v1.2.3");
    passed(await command([launcher, "update", "v1.2.4"], environment));
    const updated = JSON.parse(await readFile(join(root, "installation.json"), "utf8"));
    expect(updated.repo).toBe("installer-fixture/public-fork");
    expect(updated.version).toBe("v1.2.4");
    expect(updated.release).not.toBe(installed.release);
    expect((await readFile(requests, "utf8")).trim().split("\n")).toEqual([
      "https://github.com/installer-fixture/public-fork/releases/download/v1.2.3/document-extraction.tar.gz",
      "https://github.com/installer-fixture/public-fork/releases/download/v1.2.3/document-extraction.tar.gz.sha256",
      "https://github.com/installer-fixture/public-fork/releases/download/v1.2.4/document-extraction.tar.gz",
      "https://github.com/installer-fixture/public-fork/releases/download/v1.2.4/document-extraction.tar.gz.sha256",
    ]);
    passed(await command([launcher, "doctor"]));
    passed(await command([launcher, "stop"]));
    expect(await readFile(join(config, "config.env"), "utf8")).toBe(originalConfig);
    expect(await readFile(join(state, "data/better-auth-secret"), "utf8")).toBe(originalSecret);
    expect(await readFile(join(state, "operator-marker"), "utf8")).toBe("preserve me");
    const database = new Database(join(state, "data/control.sqlite"), { readonly: true });
    try { expect(database.query('SELECT email FROM "user" WHERE email = ?').get("installer@example.test")).toEqual({ email: "installer@example.test" }); }
    finally { database.close(); }
  }, 180_000);
});
