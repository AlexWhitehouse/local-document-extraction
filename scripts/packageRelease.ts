import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "..");
const canonicalRoot = await realpath(root);
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1]! : fallback;
const output = resolve(option("--output", join(root, "dist/release")));
const version = option("--version", "development");
if (!/^[A-Za-z0-9_.-]+$/.test(version)) throw new Error("Release version must be a simple tag name.");
const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (status.status !== 0) throw new Error("Release packaging requires a Git checkout.");
const dirty = status.stdout.trim().length > 0;
if (version !== "development" && dirty) throw new Error("Commit or remove all pending changes before packaging a versioned release. Use the default development version for local installer tests.");
const listing = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
if (listing.status !== 0) throw new Error("Release packaging requires a Git checkout.");
const roots = new Set(["package.json", "bun.lock", "bunfig.toml", ".env.example", ".gitignore", ".gitleaksignore", "README.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "AGENTS.md", "CONTEXT-MAP.md", "eslint.config.mjs", "playwright.config.ts"]);
const files = [...new Set(listing.stdout.split("\0").filter((file) => roots.has(file) || /^(backend|frontend|scripts|docs|mkdocs|e2e|postman|\.github)\//.test(file)))]
  .filter((file) => !/(^|\/)(node_modules|dist|coverage|\.local|\.git|\.scratch)(\/|$)/.test(file))
  .filter((file) => !/(^|\/)(\.env(\.(?!example$)[^/]*)?|\.vars|\.dev\.vars|.*\.(sqlite|sqlite-wal|sqlite-shm|db|log))$/.test(file));
for (const required of ["package.json", "bun.lock", ".env.example", "scripts/install.sh", "scripts/installApplication.ts", "backend/src/checkConfiguration.ts"]) {
  if (!files.includes(required)) throw new Error(`Required release file is missing: ${required}`);
}
const staging = await mkdtemp(join(tmpdir(), "document-extraction-release-"));
try {
  for (const file of files) {
    const source = join(root, file);
    if (!(await lstat(source)).isFile()) throw new Error(`Release entry is not a regular file: ${file}`);
    if (!(await realpath(source)).startsWith(`${canonicalRoot}/`)) throw new Error(`Release entry escapes the checkout: ${file}`);
    await mkdir(dirname(join(staging, file)), { recursive: true });
    await copyFile(source, join(staging, file));
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  await writeFile(join(staging, "release.json"), `${JSON.stringify({ version, revision, dirty }, null, 2)}\n`);
  await mkdir(output, { recursive: true });
  const archive = join(output, "document-extraction.tar.gz");
  const result = spawnSync("tar", ["-czf", archive, "-C", staging, "."], { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (result.status !== 0) throw new Error("Release archive creation failed.");
  const hash = new Bun.CryptoHasher("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(`${archive}.sha256`, `${hash}  document-extraction.tar.gz\n`);
  await copyFile(join(root, "scripts/install.sh"), join(output, "install.sh"));
  console.log(`Release assets: ${output}\nSHA256: ${hash}`);
} finally { await rm(staging, { recursive: true, force: true }); }
