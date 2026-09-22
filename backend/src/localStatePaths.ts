import { closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";

async function existingStatePath(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Call for the state root first, then each child in parent-before-child order. */
export async function ensurePrivateStateDirectory(path: string, { recursive = false } = {}): Promise<void> {
  const existing = await existingStatePath(path);
  if (existing && !existing.isDirectory()) {
    throw new Error("Local state directories must be real directories, not symbolic links or files.");
  }
  await mkdir(path, { recursive, mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.chmod(0o700); }
  finally { await directory.close(); }
}

export async function assertRegularStateFile(path: string): Promise<void> {
  const existing = await existingStatePath(path);
  if (existing && !existing.isFile()) {
    throw new Error("Local state files must be regular files, not symbolic links or directories.");
  }
}

/** Synchronous counterpart for the SQLite store and machine-credential vault. */
export function ensurePrivateStateDirectorySync(path: string, { recursive = false } = {}): void {
  try { assertRealStateDirectorySync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { mkdirSync(path, { recursive, mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fchmodSync(directory, 0o700); }
  finally { closeSync(directory); }
}

/** Read-only directory validation: missing directories remain missing. */
export function assertRealStateDirectorySync(path: string): void {
  if (!lstatSync(path).isDirectory()) throw new Error("Local state directories must be real directories, not symbolic links or files.");
}

export function assertRegularStateFileSync(path: string): void {
  try {
    if (!lstatSync(path).isFile()) throw new Error("Local state files must be regular files, not symbolic links or directories.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
