import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";

export const PACKAGE_HYGIENE_COMMANDS = [
  { arguments: ["audit", "--prod", "--json"], name: "production audit" },
  { arguments: ["dedupe", "--check"], name: "dedupe check" },
  { arguments: ["pm", "licenses", "--prod", "--json"], name: "production licenses" },
] as const;

type LicenseEntry = {
  name: string;
  paths?: string[];
  versions?: string[];
  [key: string]: unknown;
};

export type LicenseInventory = Record<string, LicenseEntry[]>;

export type PackageHygieneSummary = {
  auditAdvisories: number;
  bunRevision: string;
  bunVersion: string;
  dedupeOutput: string;
  licensePackageCount: number;
  licenseTypes: number;
  platform: string;
};

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

const repositoryRoot = resolve(import.meta.dir, "..");
const artifactDirectory = resolve(repositoryRoot, ".scratch/ci/package-hygiene");

export function normalizeLicenseInventory(
  inventory: LicenseInventory,
  root: string,
): LicenseInventory {
  const normalized: LicenseInventory = {};
  const rootPrefix = `${root}${sep}`;
  for (const license of Object.keys(inventory).sort((left, right) => left.localeCompare(right))) {
    normalized[license] = [...(inventory[license] ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name)
        || JSON.stringify(left.versions ?? []).localeCompare(JSON.stringify(right.versions ?? [])))
      .map((entry) => ({
        ...entry,
        ...(entry.paths ? {
          paths: [...entry.paths].sort().map((path) => path.startsWith(rootPrefix)
            ? `<repo>/${path.slice(rootPrefix.length).split(sep).join("/")}`
            : `<external>/${basename(path)}`),
        } : {}),
      }));
  }
  return normalized;
}

export function validateProductionAudit(json: string): { advisoryCount: number } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error("Bun production audit did not return valid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bun production audit must return a JSON object");
  }
  const advisoryCount = Object.keys(value).length;
  if (advisoryCount > 0) {
    throw new Error(`${advisoryCount} production advisor${advisoryCount === 1 ? "y" : "ies"} require review`);
  }
  return { advisoryCount };
}

export function renderPackageHygieneSummary(summary: PackageHygieneSummary): string {
  return [
    "# Bun package hygiene",
    "",
    `- Runtime: Bun ${summary.bunVersion} (${summary.bunRevision})`,
    `- Platform: ${summary.platform}`,
    "- Policy: non-mutating production audit, dedupe check, and license inventory; no automatic fixes or updates.",
    "",
    "| Check | Result |",
    "| --- | ---: |",
    `| Production advisories | ${summary.auditAdvisories} |`,
    `| Removable compatible duplicates | 0 |`,
    `| Production packages inventoried | ${summary.licensePackageCount} |`,
    `| License expressions | ${summary.licenseTypes} |`,
    "",
    "## Dedupe output",
    "",
    "```text",
    boundDiagnostic(summary.dedupeOutput || "No duplicate versions can be removed."),
    "```",
    "",
    "Artifacts are generated from the installed frozen graph. Audit and dedupe failures are reported but never repaired automatically.",
    "",
  ].join("\n");
}

async function runPackageHygiene(): Promise<void> {
  await mkdir(artifactDirectory, { recursive: true });
  const results = new Map<string, CommandResult>();
  for (const command of PACKAGE_HYGIENE_COMMANDS) {
    results.set(command.name, await runBun(command.arguments));
  }
  const audit = results.get("production audit")!;
  const dedupe = results.get("dedupe check")!;
  const licenses = results.get("production licenses")!;
  const failures: string[] = [];

  let auditAdvisories = 0;
  try {
    auditAdvisories = validateProductionAudit(audit.stdout).advisoryCount;
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (audit.exitCode !== 0 && auditAdvisories === 0) {
    failures.push(`Production audit exited ${audit.exitCode}: ${boundDiagnostic(audit.stderr || audit.stdout)}`);
  }
  if (dedupe.exitCode !== 0) {
    failures.push(`Dedupe check found a lockfile change: ${boundDiagnostic(dedupe.stdout || dedupe.stderr)}`);
  }

  let normalizedLicenses: LicenseInventory = {};
  try {
    normalizedLicenses = normalizeLicenseInventory(JSON.parse(licenses.stdout) as LicenseInventory, repositoryRoot);
  } catch (error) {
    failures.push(`Production license inventory failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (licenses.exitCode !== 0) {
    failures.push(`Production licenses exited ${licenses.exitCode}: ${boundDiagnostic(licenses.stderr || licenses.stdout)}`);
  }

  const licensePackageCount = Object.values(normalizedLicenses)
    .reduce((count, entries) => count + entries.length, 0);
  const summary = renderPackageHygieneSummary({
    auditAdvisories,
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    dedupeOutput: dedupe.stdout || dedupe.stderr,
    licensePackageCount,
    licenseTypes: Object.keys(normalizedLicenses).length,
    platform: `${platform()} ${arch()}`,
  });
  await Promise.all([
    writeFile(resolve(artifactDirectory, "production-audit.json"), prettyJsonOrDiagnostic(audit.stdout, audit.stderr), "utf8"),
    writeFile(resolve(artifactDirectory, "production-licenses.json"), `${JSON.stringify(normalizedLicenses, null, 2)}\n`, "utf8"),
    writeFile(resolve(artifactDirectory, "dedupe-check.txt"), `${boundDiagnostic(dedupe.stdout || dedupe.stderr)}\n`, "utf8"),
    writeFile(resolve(artifactDirectory, "package-hygiene-summary.md"), summary, "utf8"),
  ]);
  process.stdout.write(summary);
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

async function runBun(arguments_: readonly string[]): Promise<CommandResult> {
  const child = Bun.spawn([process.execPath, "--no-env-file", ...arguments_], {
    cwd: repositoryRoot,
    env: {
      CI: "1",
      NO_COLOR: "1",
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function prettyJsonOrDiagnostic(stdout: string, stderr: string): string {
  try {
    return `${JSON.stringify(JSON.parse(stdout), null, 2)}\n`;
  } catch {
    return `${JSON.stringify({ error: boundDiagnostic(stderr || stdout || "No audit output") }, null, 2)}\n`;
  }
}

function boundDiagnostic(value: string): string {
  const normalized = value.replaceAll(repositoryRoot, "<repo>").trim();
  return normalized.length > 8_000 ? `${normalized.slice(0, 8_000)}\n…diagnostic truncated…` : normalized;
}

if (import.meta.main) await runPackageHygiene();
