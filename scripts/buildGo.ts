import { copyFile, cp, mkdir, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { installPdfium, pdfiumLibraryName } from "./pdfium";

const root = resolve(import.meta.dir, "..");

const bin = join(root, "backend-go", "bin");

const packaged = join(bin, `${process.platform}-${process.arch}`);

const files = ["document-extraction", "document-extraction-pdf", pdfiumLibraryName(process.platform)];

await mkdir(bin, { recursive: true });

if (await Bun.file(join(packaged, "document-extraction")).exists()) {
  for (const file of files) await copyFile(join(packaged, file), join(bin, file));

  await cp(join(packaged, "pdfium-licenses"), join(bin, "pdfium-licenses"), { recursive: true });

  await chmod(join(bin, "document-extraction"), 0o755);
  await chmod(join(bin, "document-extraction-pdf"), 0o755);
} else {
  for (const [output, command] of [["document-extraction", "./cmd/document-extraction"], ["document-extraction-pdf", "./cmd/pdf-worker"]]) {
    const result = spawnSync("go", ["build", "-trimpath", "-o", join(bin, output!), command!], {
      cwd: join(root, "backend-go"), stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0" },
    });

    if (result.error || result.status !== 0) throw new Error("Building the document processor requires Go matching backend-go/go.mod. Install Go and run bun run build again.");
  }

  await installPdfium(process.platform, process.arch, bin, join(bin, ".cache"));
}
