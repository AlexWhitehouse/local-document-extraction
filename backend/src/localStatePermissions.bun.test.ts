import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLocalStateDirectories } from "./localRuntime";

test("startup protects new and existing state without erasing user data", async () => {
  const root = await mkdtemp(join(tmpdir(), "private-local-state-"));
  const state = join(root, "state");
  try {
    await mkdir(join(state, "data"), { recursive: true });
    await chmod(state, 0o755);
    await chmod(join(state, "data"), 0o755);
    await writeFile(join(state, "data", "sentinel"), "keep");
    await ensureLocalStateDirectories(state);
    for (const relative of ["", "data", "data/workspaces", "source-files", "source-files/workspaces", "mail", "analytics"]) {
      expect((await stat(join(state, relative))).mode & 0o777).toBe(0o700);
    }
    expect(await Bun.file(join(state, "data", "sentinel")).text()).toBe("keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state permission repair refuses symlink roots and children without touching their targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-state-symlink-"));
  try {
    const outside = join(root, "outside");
    const state = join(root, "state");
    await mkdir(outside, { mode: 0o755 });
    await chmod(outside, 0o755);
    await symlink(outside, state);
    await expect(ensureLocalStateDirectories(state)).rejects.toThrow("real directories");
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
    await rm(state);
    await mkdir(state);
    await symlink(outside, join(state, "data"));
    await expect(ensureLocalStateDirectories(state)).rejects.toThrow("real directories");
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
    expect(await readdir(outside)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
