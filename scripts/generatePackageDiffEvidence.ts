import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

type PackageUpgradeReview = {
  category: "parser" | "build-tool" | "spreadsheet" | "networking";
  from: string;
  kind: "upgrade";
  name: string;
  rationale: string;
  to: string;
};

type UnchangedPackageReview = {
  category: "authentication" | "native-binary";
  from: string;
  kind: "unchanged";
  name: string;
  rationale: string;
  to: string;
};

export const sensitivePackageReviews: Array<PackageUpgradeReview | UnchangedPackageReview> = [
  { category: "parser", from: "6.1.200", kind: "upgrade", name: "pdfjs-dist", rationale: "Malicious-PDF JavaScript execution advisory repair.", to: "6.2.108" },
  { category: "build-tool", from: "5.4.21", kind: "upgrade", name: "vite", rationale: "Remove the vulnerable Vite/esbuild line and align build/test tooling.", to: "8.2.2" },
  { category: "spreadsheet", from: "8.3.2", kind: "upgrade", name: "uuid", rationale: "Narrow override removes ExcelJS's vulnerable transitive UUID release.", to: "11.1.1" },
  { category: "networking", from: "7.28.0", kind: "upgrade", name: "undici", rationale: "Range-compatible production audit repair.", to: "7.29.0" },
  { category: "authentication", from: "1.6.23", kind: "unchanged", name: "better-auth", rationale: "No authentication package version changed in this Bun/security batch.", to: "1.6.23" },
  { category: "native-binary", from: "1.0.2", kind: "unchanged", name: "@napi-rs/canvas", rationale: "No native package version changed; global-store smoke covers the existing optional binary.", to: "1.0.2" },
];

type PackageDiffEvidence = {
  files: Array<Record<string, unknown>>;
  from: string;
  notes: string[];
  to: string;
  totals: {
    added: number;
    deleted: number;
    files: number;
    linesAdded: number;
    linesRemoved: number;
  };
};

const repositoryRoot = resolve(import.meta.dir, "..");
const evidenceDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/evidence/20-package-diffs");
const rawDirectory = resolve(repositoryRoot, ".scratch/bun-1-4-review/raw/20-package-diffs");

export function validatePackageDiffEvidence(value: unknown): asserts value is PackageDiffEvidence {
  if (!value || typeof value !== "object") throw new Error("Package diff must be an object");
  const candidate = value as Partial<PackageDiffEvidence>;
  if (typeof candidate.from !== "string" || typeof candidate.to !== "string") {
    throw new Error("Package diff is missing from/to package identities");
  }
  if (!Array.isArray(candidate.files)) throw new Error("Package diff is missing files");
  if (!Array.isArray(candidate.notes)) throw new Error("Package diff is missing security notes");
  if (!candidate.totals || typeof candidate.totals.files !== "number") {
    throw new Error("Package diff is missing totals");
  }
}

export function summarizePackageDiffEvidence(evidence: PackageDiffEvidence): PackageDiffEvidence {
  validatePackageDiffEvidence(evidence);
  return {
    ...evidence,
    files: evidence.files.map((file) => {
      const { patch, ...metadata } = file;
      if (typeof patch !== "string") return metadata;
      return {
        ...metadata,
        patchBytes: Buffer.byteLength(patch),
        patchSha256: createHash("sha256").update(patch).digest("hex"),
      };
    }),
  };
}

async function generatePackageDiffEvidence(): Promise<void> {
  await Promise.all([
    mkdir(evidenceDirectory, { recursive: true }),
    mkdir(rawDirectory, { recursive: true }),
  ]);
  const generated: Array<{ review: PackageUpgradeReview; evidence: PackageDiffEvidence; filename: string }> = [];
  for (const review of sensitivePackageReviews) {
    if (review.kind !== "upgrade") continue;
    process.stdout.write(`Reviewing ${review.name} ${review.from} → ${review.to}...\n`);
    const child = Bun.spawn([
      process.execPath,
      "--no-env-file",
      "pm",
      "diff",
      `${review.name}@${review.from}`,
      review.to,
      "--json",
    ], {
      cwd: repositoryRoot,
      env: { NO_COLOR: "1", PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`bun pm diff failed for ${review.name}: ${(stderr || stdout).slice(-4_000)}`);
    }
    const evidence = JSON.parse(stdout) as unknown;
    validatePackageDiffEvidence(evidence);
    const filename = `${safeName(review.name)}-${review.from}-to-${review.to}.json`;
    await Promise.all([
      writeFile(resolve(rawDirectory, filename), `${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
      writeFile(resolve(evidenceDirectory, filename), `${JSON.stringify(summarizePackageDiffEvidence(evidence), null, 2)}\n`, "utf8"),
    ]);
    generated.push({ evidence, filename, review });
  }

  const summary = [
    "# Sensitive package review evidence",
    "",
    `- Runtime: Bun ${Bun.version} (${Bun.revision})`,
    "- Command: `bun run package:diff-evidence`",
    "- Evidence: registry package contents only; no dependency is installed, fixed, or updated by this command.",
    "- Artifact policy: complete normalized patches stay in ignored raw scratch state; shareable JSON keeps every file/status/count plus patch byte size and SHA-256, while Bun's security notes retain install-script, entry-point, executable, sensitive-import, and package-import findings.",
    "",
    "| Category | Package transition | Files | +Lines | -Lines | Review notes | Artifact |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ...generated.map(({ evidence, filename, review }) => `| ${review.category} | \`${review.name}@${review.from}\` → \`${review.to}\` | ${evidence.totals.files} | ${evidence.totals.linesAdded} | ${evidence.totals.linesRemoved} | ${[review.rationale, ...evidence.notes].join(" ").replaceAll("|", "\\|")} | [JSON](${filename}) |`),
    "",
    "## Unchanged sensitive boundaries",
    "",
    ...sensitivePackageReviews.filter((review): review is UnchangedPackageReview => review.kind === "unchanged")
      .map((review) => `- **${review.category}:** \`${review.name}@${review.to}\` — ${review.rationale}`),
    "",
    "The JSON records include changed/added/deleted files, install-script and entry-point notes, new package/sensitive-module imports, executable-file changes, and normalized patches as reported by Bun 1.4 `pm diff`.",
    "",
  ].join("\n");
  await writeFile(resolve(evidenceDirectory, "README.md"), summary, "utf8");
  process.stdout.write(summary);
}

function safeName(name: string): string {
  return name.replace(/^@/, "").replaceAll("/", "-");
}

if (import.meta.main) await generatePackageDiffEvidence();
