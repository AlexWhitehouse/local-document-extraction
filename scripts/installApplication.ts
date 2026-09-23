import { constants } from "node:fs";
import { chmod, copyFile, cp, lstat, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { collectInstallerConfiguration, createSetupTerminal, renderInstallerConfiguration, shouldPromptForConfiguration } from "./installerConfiguration";
import {
  privateDirectory, runApplicationCommand, runningInstallation, startInstallation,
  stopInstallation, withManagementLock, writePrivateFile, type Installation,
} from "./manageInstallation";

function argumentsMap() {
  const entries = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 2) values.set(entries[index]!, entries[index + 1]!);
  const required = (key: string) => { const value = values.get(key); if (!value) throw new Error(`Missing ${key}`); return value; };
  return { values, required };
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const exists = async (path: string) => Boolean(await lstat(path).catch(() => null));
const within = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep)); };

// Resolve symlink ancestors even when the destination does not exist yet.
async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await canonicalPath(parent), relative(parent, absolute));
  }
}

async function validateDirectories(paths: string[], source: string) {
  const protectedRoots = await Promise.all([
    "/", "/tmp", "/var/tmp", "/var", "/usr", "/opt", "/etc", "/bin", "/sbin",
    "/Applications", "/Library", "/Users", "/home", "/root", homedir(), tmpdir(), process.cwd(), source, dirname(source),
    ...["Documents", "Downloads", "Desktop", "Library", "Applications", ".config", ".local/share", ".local/state", ".local/bin"].map((path) => join(homedir(), path)),
    ...[process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_STATE_HOME].filter((path): path is string => Boolean(path)),
  ].map(canonicalPath));
  for (const path of paths) {
    if (protectedRoots.some((protectedRoot) => within(path, protectedRoot))) throw new Error("Choose dedicated application, configuration, and state subdirectories; broad filesystem/home/working/temporary roots are not allowed.");
  }
  for (let first = 0; first < paths.length; first += 1) {
    for (let second = first + 1; second < paths.length; second += 1) {
      if (within(paths[first]!, paths[second]!) || within(paths[second]!, paths[first]!)) {
        throw new Error("Application, configuration, and state directories must be separate, non-overlapping directories.");
      }
    }
  }
}

async function ensureArchiveSafe(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name === ".local" || item.name === ".git" || item.name === ".env" || (item.name.startsWith(".env.") && item.name !== ".env.example")) {
      throw new Error("Release archive contains local state, dependencies, or private configuration.");
    }
    if (item.isSymbolicLink()) throw new Error("Release archives must not contain symbolic links.");
    if (item.isDirectory()) await ensureArchiveSafe(join(directory, item.name));
  }
}

async function install() {
  const { values, required } = argumentsMap();
  const source = resolve(required("--source"));
  const root = await canonicalPath(required("--install-dir"));
  const configDirectory = await canonicalPath(required("--config-dir"));
  const state = await canonicalPath(required("--state-dir"));
  await validateDirectories([root, configDirectory, state], source);
  for (const ownedPath of [join(root, "runtimes"), join(root, "releases"), join(root, "backups"), join(configDirectory, "config.env")]) {
    if ((await lstat(ownedPath).catch(() => null))?.isSymbolicLink()) throw new Error("Installer-managed files and directories must not be symbolic links.");
  }
  const existingConfig = await lstat(join(configDirectory, "config.env")).catch(() => null);
  if (existingConfig && !existingConfig.isFile()) throw new Error("Existing config.env must be a regular file.");
  const releases = join(root, "releases");
  await ensureArchiveSafe(source);
  await withManagementLock(root, async () => {
    if (await runningInstallation(root)) throw new Error(`Stop the installed application before upgrading: ${join(root, "document-extraction")} stop`);
    const packageJson = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { packageManager: string };
    const bunVersion = packageJson.packageManager.replace(/^bun@/, "");
    const runtimeBin = join(root, "runtimes", `bun-${bunVersion}`, "bin");
    if (await canonicalPath(runtimeBin) !== runtimeBin) throw new Error("The application runtime directory must not contain symbolic links.");
    await privateDirectory(runtimeBin);
    const bun = join(runtimeBin, "bun");
    if (!await exists(bun)) {
      await copyFile(required("--bun"), bun);
      await chmod(bun, 0o700);
    }
    const runtimeVersion = spawnSync(bun, ["--version"], { encoding: "utf8" });
    if (runtimeVersion.status !== 0 || runtimeVersion.stdout.trim() !== bunVersion) throw new Error("Application-owned Bun does not match the packageManager pin.");
    if (!await exists(join(runtimeBin, "bunx"))) await symlink("bun", join(runtimeBin, "bunx"));
    const identity = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${required("--sha256").slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`;
    const release = join(releases, identity);
    await privateDirectory(releases);
    await cp(source, release, { recursive: true, errorOnExist: true, force: false });
    await chmod(release, 0o700);
    const installation: Installation = {
      root, release, bun, configFile: join(configDirectory, "config.env"), state,
      repo: required("--repo"), version: required("--version"), sha256: required("--sha256"),
    };
    let migrationStarted = false;
    let complete = false;
    try {
      const dependencyEnvironment = { ...process.env, PATH: `${runtimeBin}${sep === "/" ? ":" : ";"}${process.env.PATH || ""}` };
      const lockBefore = await Bun.file(join(release, "bun.lock")).text();
      for (const args of [["install", "--frozen-lockfile"], ["run", "build"]]) {
        const result = spawnSync(bun, args, { cwd: release, env: dependencyEnvironment, stdio: "inherit" });
        if (result.status !== 0) throw new Error(`Installation command failed: bun ${args.join(" ")}`);
      }
      if (await Bun.file(join(release, "bun.lock")).text() !== lockBefore) throw new Error("Dependency installation changed the frozen lockfile.");
      await privateDirectory(configDirectory);
      await privateDirectory(state);
      if (!await exists(installation.configFile)) {
        const example = await readFile(join(release, ".env.example"), "utf8");
        let contents = example;
        if (shouldPromptForConfiguration(values.get("--setup-mode"))) {
          const terminal = createSetupTerminal();
          try {
            const answers = await collectInstallerConfiguration(terminal, `http://127.0.0.1:${process.env.PORT || 8787}`);
            contents = renderInstallerConfiguration(example, answers);
            const overrides = Object.keys(answers).filter((key) => process.env[key] !== undefined);
            if (overrides.length) terminal.say(`Existing process environment overrides saved settings: ${overrides.join(", ")}. Unset these variables to use config.env.`);
          } finally { terminal.close(); }
        }
        await writeFile(installation.configFile, contents, { mode: 0o600, flag: "wx" });
      } else {
        console.log("Keeping existing config.env; setup questions are skipped on upgrades.");
      }
      const configuration = await open(installation.configFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await configuration.stat()).isFile()) throw new Error("Existing config.env must be a regular file.");
        await configuration.chmod(0o600);
      } finally { await configuration.close(); }
      runApplicationCommand(installation, "backend/src/checkConfiguration.ts");
      runApplicationCommand(installation, "scripts/nativeSmoke.ts");
      let backup: string | undefined;
      if ((await readdir(state)).length) {
        backup = join(root, "backups", `before-${identity}`);
        await privateDirectory(dirname(backup));
        await cp(state, backup, { recursive: true, errorOnExist: true, force: false });
        await chmod(backup, 0o700);
        console.log(`Pre-migration backup: ${backup}`);
      }
      await writePrivateFile(join(root, "upgrade-incomplete.json"), `${JSON.stringify({ release, backup, state })}\n`);
      migrationStarted = true;
      runApplicationCommand(installation, "backend/src/migrate.ts");
      const running = await startInstallation(installation);
      if (values.get("--no-start") === "true") await stopInstallation(root);
      await writePrivateFile(join(root, "manageInstallation.ts"), await readFile(join(release, "scripts/manageInstallation.ts"), "utf8"));
      const launcher = `#!/bin/sh\nexec ${shellQuote(bun)} --no-env-file ${shellQuote(join(root, "manageInstallation.ts"))} ${shellQuote(root)} "$@"\n`;
      await writePrivateFile(join(root, "installation.json"), `${JSON.stringify(installation, null, 2)}\n`);
      await writePrivateFile(join(root, "document-extraction"), launcher, 0o700);
      await rm(join(root, "upgrade-incomplete.json"), { force: true });
      complete = true;
      console.log(`\nInstallation verified${values.get("--no-start") === "true" ? " (stopped)" : `: ${running.origin}`}\nLauncher: ${join(root, "document-extraction")}\nConfig: ${installation.configFile}\nState: ${state}\nFor local account verification: ${shellQuote(join(root, "document-extraction"))} mail\nOptional PATH for this shell: export PATH=${shellQuote(root)}:"$PATH"`);
    } finally {
      if (!complete && migrationStarted) {
        await stopInstallation(root).catch(() => undefined);
        console.error(`Installation did not complete after migration began. State was preserved; no automatic rollback was attempted. Inspect ${join(root, "upgrade-incomplete.json")} and the private backup before recovery. Retry the installation after resolving the error.`);
      } else if (!complete) await rm(release, { recursive: true, force: true });
    }
  });
}

try { await install(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
