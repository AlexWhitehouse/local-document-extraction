import { test, expect } from "bun:test";
import { createSourceDirectoryPublication } from "./localSourcePublication";

test("publication waits for parent barriers and later renames require a fresh barrier", async () => {
  const calls: string[] = [];
  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  let first = true;

  const publish = createSourceDirectoryPublication(async (path) => {
    calls.push(path);

    if (path === "/workspace/jobs" && first) { first = false; reached(); await blocked; }
  });

  let acknowledged = false;
  const a = publish("/workspace/jobs/a").then(() => { acknowledged = true; });
  const b = publish("/workspace/jobs/b");
  await started;
  expect(acknowledged).toBe(false);
  const c = publish("/workspace/jobs/c");
  release();
  await Promise.all([a, b, c]);
  expect(calls.filter((path) => path === "/workspace/jobs")).toHaveLength(2);
  expect(calls.indexOf("/workspace/jobs/a")).toBeLessThan(calls.indexOf("/workspace/jobs"));
  expect(calls.indexOf("/workspace/jobs/b")).toBeLessThan(calls.indexOf("/workspace/jobs"));
});

test("a directory flush failure rejects its publication without accepting it early", async () => {
  const publish = createSourceDirectoryPublication(async (path) => { if (path === "/workspace/a") throw new Error("fsync failed"); });
  const results = await Promise.allSettled([publish("/workspace/a/job"), publish("/workspace/b/job")]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
});
