import { copyFile, mkdir, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "..");

const output = join(root, "backend-go", "bin", "document-extraction");

const packaged = join(root, "backend-go", "bin", `${process.platform}-${process.arch}`, "document-extraction");

await mkdir(join(root, "backend-go", "bin"), { recursive: true });

if (await Bun.file(packaged).exists()) {
  await copyFile(packaged, output);
  await chmod(output, 0o755);
} else {
  const result = spawnSync("go", ["build", "-trimpath", "-o", output, "./cmd/document-extraction"], {
    cwd: join(root, "backend-go"), stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0" },
  });

  if (result.error || result.status !== 0) throw new Error("Building the document processor requires Go matching backend-go/go.mod. Install Go and run bun run build again.");
}
