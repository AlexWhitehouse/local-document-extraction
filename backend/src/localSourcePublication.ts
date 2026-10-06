import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function syncSourceContents(path: string): Promise<void> {
  const file = await open(path, "r");

  try { await file.sync(); } finally { await file.close(); }
}

type Publication = { directories: string[]; resolve(): void; reject(error: Error): void };

/** Mutations join only the next batch. An fsync already in flight cannot cover a
 * later rename. Flush children before parents, sharing ancestor barriers across
 * concurrent publications without acknowledging any early.
 */
export function createSourceDirectoryPublication(syncDirectory = syncSourceContents) {
  let pending: Publication[] = [];

  const flush = async () => {
    const batch = pending;
    pending = [];
    const directories = new Set(batch.flatMap((entry) => entry.directories));
    const failures = new Map<string, Error>();
    const levels = new Map<number, string[]>();

    for (const directory of directories) {
      const depth = directory.split(/[\\/]/).length;
      const paths = levels.get(depth) ?? [];
      paths.push(directory);
      levels.set(depth, paths);
    }

    for (const depth of [...levels.keys()].sort((a, b) => b - a)) {
      await Promise.all(levels.get(depth)!.map(async (path) => {
        try { await syncDirectory(path); }
        catch (error) { failures.set(path, error instanceof Error ? error : new Error("Source publication failed")); }
      }));
    }

    for (const entry of batch) {
      const failed = entry.directories.find((path) => failures.has(path));

      if (failed) entry.reject(failures.get(failed)!);
      else entry.resolve();
    }
  };

  return (directory: string): Promise<void> => new Promise((complete, reject) => {
    const directories: string[] = [];
    let current = resolve(directory);

    for (;;) {
      directories.push(current);
      const parent = dirname(current);

      if (parent === current) break;
      current = parent;
    }

    if (!pending.length) setTimeout(() => { void flush(); }, 2);
    pending.push({ directories, resolve: complete, reject });
  });
}

export const publishSourceDirectory = createSourceDirectoryPublication();

export async function publishSourceFile(path: string): Promise<void> {
  await syncSourceContents(path);
  await publishSourceDirectory(dirname(path));
}
