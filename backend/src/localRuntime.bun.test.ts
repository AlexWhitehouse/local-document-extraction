import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  createLocalRuntimeFetchHandler,
  ensureLocalStateDirectories,
} from "./localRuntime";
import { createLocalApplication } from "./localApplication";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("local Bun runtime", () => {
  it("exposes the health endpoint through the local Fetch application", async () => {
    const application = createLocalApplication();

    const response = await application(new Request("http://localhost:8787/v1/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "document-extraction-api" });
  });

  it("creates the local state directory structure", async () => {
    const rootDirectory = await createTemporaryDirectory("document-extraction-state-");
    const stateDirectory = join(rootDirectory, ".local");

    await ensureLocalStateDirectories(stateDirectory);

    const directories = [
      "data",
      "data/workspaces",
      "source-files/workspaces",
      "mail",
      "analytics",
    ];
    await Promise.all(directories.map(async (directory) => {
      expect((await stat(join(stateDirectory, directory))).isDirectory()).toBe(true);
    }));
  });

  it("routes API Requests to the Fetch-style application handler", async () => {
    const assetsDirectory = await createTemporaryDirectory("document-extraction-assets-");
    const api = mock(async () => Response.json({ ok: true, service: "document-extraction-api" }));
    const fetch = createLocalRuntimeFetchHandler({ assetsDirectory, api });

    const response = await fetch(new Request("http://localhost:8787/v1/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "document-extraction-api" });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(expect.any(Request));
  });

  it("serves built assets and falls back to the SPA for non-API reads", async () => {
    const assetsDirectory = await createTemporaryDirectory("document-extraction-assets-");
    await writeFile(join(assetsDirectory, "index.html"), "<main>Document Extraction</main>");
    await writeFile(join(assetsDirectory, "app.js"), "console.log('ready')");
    const api = mock(async () => new Response(null, { status: 404 }));
    const fetch = createLocalRuntimeFetchHandler({ assetsDirectory, api });

    const assetResponse = await fetch(new Request("http://localhost:8787/app.js"));
    const spaResponse = await fetch(new Request("http://localhost:8787/workspaces/demo/templates"));
    const headResponse = await fetch(new Request("http://localhost:8787/workspaces/demo/templates", { method: "HEAD" }));

    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
    await expect(assetResponse.text()).resolves.toBe("console.log('ready')");
    await expect(spaResponse.text()).resolves.toBe("<main>Document Extraction</main>");
    expect(headResponse.status).toBe(200);
    await expect(headResponse.text()).resolves.toBe("");
    expect(api).not.toHaveBeenCalled();
  });
});
