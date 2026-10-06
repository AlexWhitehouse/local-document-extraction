import { publishSourceDirectory, syncSourceContents } from "./localSourcePublication";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isJsonObject, isString, parseJson } from "../../shared/json";
import { validatePdfPageSelection } from "./lib/pdfPageOperations";

export type LocalPdfSourceView = { path: string; pages: number[]; identity: string };

/** The manifest is published last. Its sibling hard link owns the immutable bytes
 * independently of the packet's lifetime; deleting one owner cannot break another.
 */
export async function readPdfSourceView(path: string): Promise<LocalPdfSourceView | null> {
  if (!path.endsWith("/source.view")) return null;
  const value = parseJson(await readFile(path, "utf8"));

  if (!isJsonObject(value) || value.version !== 1 || !isString(value.identity)) throw new Error("Invalid PDF Source view");

  return { path: join(dirname(path), "source.backing.pdf"), pages: validatePdfPageSelection(value.pages, 10_000), identity: value.identity };
}

export async function writePdfSourceView(destination: string, source: LocalPdfSourceView): Promise<void> {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });
  const backing = join(directory, "source.backing.pdf");
  const pending = `${destination}.pending`;
  // Reserved children can be retried after a crash before their DB commit. There
  // is no live reader until publication in the authoritative store.
  await rm(backing, { force: true });
  await link(source.path, backing);
  await syncSourceContents(backing);
  const file = await open(pending, "w", 0o600);

  try {
    await file.writeFile(JSON.stringify({ version: 1, identity: source.identity, pages: source.pages }));
    await file.sync();
  } finally { await file.close(); }

  await rename(pending, destination);
  await publishSourceDirectory(directory);
}

export async function deletePdfSourceView(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(`${path}.pending`, { force: true });
  await rm(join(dirname(path), "source.backing.pdf"), { force: true });
}
