import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

/** Prebuilt PDFium (BSD-3-Clause/Apache-2.0) from bblanchon/pdfium-binaries, pinned by digest. */
export const PDFIUM_RELEASE = "chromium/8086";

const ARCHIVES = new Map([
  ["linux-x64", { asset: "pdfium-linux-x64.tgz", sha256: "588577cf52dabc1a444988bac841920df54cc2f141801424de97ab04f4fbb935", library: "libpdfium.so" }],
  ["linux-arm64", { asset: "pdfium-linux-arm64.tgz", sha256: "e7e2fe4686925618330103cb167950aca5a84bb00fd977a41b86be59dd1480a2", library: "libpdfium.so" }],
  ["darwin-x64", { asset: "pdfium-mac-x64.tgz", sha256: "933a85a138f6027243c56bff8676375c33ceeb767401389415ffc44d689ca85d", library: "libpdfium.dylib" }],
  ["darwin-arm64", { asset: "pdfium-mac-arm64.tgz", sha256: "e98679e052c07edbb5a627980902abb823d4b3f35744d877bd21668bd9fc13ab", library: "libpdfium.dylib" }],
]);

export function pdfiumLibraryName(platform: string) {
  return platform === "darwin" ? "libpdfium.dylib" : "libpdfium.so";
}

/** Places the library and its third-party licenses in destination. Downloads are cached and verified. */
export async function installPdfium(platform: string, architecture: string, destination: string, cacheDirectory: string) {
  const archive = ARCHIVES.get(`${platform}-${architecture}`);

  if (!archive) throw new Error(`PDFium is not packaged for ${platform}-${architecture}`);
  await mkdir(cacheDirectory, { recursive: true });
  const cached = join(cacheDirectory, `${PDFIUM_RELEASE.replace("/", "-")}-${archive.asset}`);

  if (!(await Bun.file(cached).exists()) || (await digest(cached)) !== archive.sha256) {
    const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_RELEASE}/${archive.asset}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`PDFium download failed (${response.status}): ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== archive.sha256)
      throw new Error(`PDFium archive checksum mismatch: ${url}`);
    await Bun.write(cached, bytes);
  }

  const staging = await mkdtemp(join(tmpdir(), "pdfium-"));

  try {
    const result = spawnSync("tar", ["-xzf", cached, "-C", staging, `lib/${archive.library}`, "LICENSE", "licenses"], { stdio: "inherit" });

    if (result.error || result.status !== 0) throw new Error(`Could not extract ${archive.asset}`);
    await mkdir(destination, { recursive: true });
    await copyFile(join(staging, "lib", archive.library), join(destination, archive.library));
    await rm(join(destination, "pdfium-licenses"), { recursive: true, force: true });
    await cp(join(staging, "licenses"), join(destination, "pdfium-licenses"), { recursive: true });
    await copyFile(join(staging, "LICENSE"), join(destination, "pdfium-licenses", "pdfium-binaries.txt"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function digest(path: string) {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}
