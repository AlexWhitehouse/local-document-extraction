import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
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

    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
    await expect(assetResponse.text()).resolves.toBe("console.log('ready')");
    await expect(spaResponse.text()).resolves.toBe("<main>Document Extraction</main>");
    expect(api).not.toHaveBeenCalled();
  });

  it("serves a lazy asset with validators, byte ranges, and equivalent bodyless HEAD metadata", async () => {
    const assetsDirectory = await createTemporaryDirectory("document-extraction-assets-");
    await writeFile(join(assetsDirectory, "index.html"), "<main>Document Extraction</main>");
    await writeFile(join(assetsDirectory, "app.js"), "console.log('ready')");
    const api = mock(async () => new Response(null, { status: 404 }));
    const handler = createLocalRuntimeFetchHandler({ assetsDirectory, api });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
    const assetUrl = `http://127.0.0.1:${server.port}/app.js`;

    try {
      const asset = await fetch(assetUrl);
      const etag = asset.headers.get("etag");
      const lastModified = asset.headers.get("last-modified");
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect(Number(asset.headers.get("content-length"))).toBe(20);
      expect(etag).toBeTruthy();
      expect(lastModified).toBeTruthy();
      await expect(asset.text()).resolves.toBe("console.log('ready')");

      const notModifiedByTag = await fetch(assetUrl, {
        headers: { "if-none-match": etag! },
      });
      expect(notModifiedByTag.status).toBe(304);
      await expect(notModifiedByTag.text()).resolves.toBe("");

      const notModifiedByDate = await fetch(assetUrl, {
        headers: { "if-modified-since": lastModified! },
      });
      expect(notModifiedByDate.status).toBe(304);

      const range = await fetch(assetUrl, { headers: { range: "bytes=0-6" } });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-range")).toBe("bytes 0-6/20");
      expect(range.headers.get("content-length")).toBe("7");
      await expect(range.text()).resolves.toBe("console");

      const unsatisfiableRange = await fetch(assetUrl, {
        headers: { range: "bytes=999-" },
      });
      expect(unsatisfiableRange.status).toBe(416);
      expect(unsatisfiableRange.headers.get("content-range")).toBe("bytes */20");
      await expect(unsatisfiableRange.text()).resolves.toBe("");

      const staleIfRange = await fetch(assetUrl, {
        headers: { range: "bytes=0-6", "if-range": '"stale"' },
      });
      expect(staleIfRange.status).toBe(200);
      expect(staleIfRange.headers.get("content-range")).toBeNull();
      await expect(staleIfRange.text()).resolves.toBe("console.log('ready')");

      const head = await fetch(assetUrl, { method: "HEAD" });
      expect(head.status).toBe(200);
      for (const name of ["content-type", "content-length", "etag", "last-modified"]) {
        expect(head.headers.get(name)).toBe(asset.headers.get(name));
      }
      await expect(head.text()).resolves.toBe("");
    } finally {
      await server.stop(true);
    }
  });

  it("keeps auth and product API routing ahead of colliding built files", async () => {
    const assetsDirectory = await createTemporaryDirectory("document-extraction-assets-");
    await mkdir(join(assetsDirectory, "api", "auth"), { recursive: true });
    await mkdir(join(assetsDirectory, "v1"), { recursive: true });
    await writeFile(join(assetsDirectory, "api", "auth", "get-session"), "asset auth");
    await writeFile(join(assetsDirectory, "v1", "health"), "asset health");
    const api = mock(async (request: Request) => Response.json({ path: new URL(request.url).pathname }));
    const handler = createLocalRuntimeFetchHandler({ assetsDirectory, api });

    const auth = await handler(new Request("http://localhost/api/auth/get-session"));
    const health = await handler(new Request("http://localhost/v1/health"));
    const frontendPost = await handler(new Request("http://localhost/templates", { method: "POST" }));

    await expect(auth.json()).resolves.toEqual({ path: "/api/auth/get-session" });
    await expect(health.json()).resolves.toEqual({ path: "/v1/health" });
    expect(frontendPost.status).toBe(404);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("does not read asset contents into an application-level buffer", async () => {
    const source = await Bun.file(new URL("./localRuntime.ts", import.meta.url)).text();

    expect(source).not.toMatch(/\breadFile\b/);
    expect(source).toContain("Bun.file(assetPath)");
  });

  it("contains encoded traversal and symlink escape attempts inside the frontend root", async () => {
    const parentDirectory = await createTemporaryDirectory("document-extraction-containment-");
    const assetsDirectory = join(parentDirectory, "dist");
    const stateDirectory = join(parentDirectory, ".local");
    await mkdir(assetsDirectory, { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(assetsDirectory, "index.html"), "<main>Safe SPA</main>");
    await writeFile(join(stateDirectory, "sentinel.txt"), "PRIVATE_LOCAL_STATE");
    await symlink(join(stateDirectory, "sentinel.txt"), join(assetsDirectory, "linked-state.txt"));
    const handler = createLocalRuntimeFetchHandler({
      assetsDirectory,
      api: async () => new Response(null, { status: 404 }),
    });
    const probes = [
      "/../.local/sentinel.txt",
      "/%2e%2e/.local/sentinel.txt",
      "/..%2f.local%2fsentinel.txt",
      "/%252e%252e%252f.local%252fsentinel.txt",
      "/%5c..%5c.local%5csentinel.txt",
      "/%E0%A4%A",
      "/linked-state.txt",
    ];

    for (const probe of probes) {
      const response = await handler(new Request(`http://localhost${probe}`));
      expect(await response.text()).not.toContain("PRIVATE_LOCAL_STATE");
    }
  });

  it("retains the unavailable response when the frontend build is missing", async () => {
    const assetsDirectory = join(
      await createTemporaryDirectory("document-extraction-assets-missing-"),
      "dist",
    );
    const handler = createLocalRuntimeFetchHandler({
      assetsDirectory,
      api: async () => new Response(null, { status: 404 }),
    });

    const response = await handler(new Request("http://localhost/workspaces/demo"));

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Frontend build not found");

    await mkdir(assetsDirectory, { recursive: true });
    await writeFile(join(assetsDirectory, "index.html"), "<main>Late build</main>");
    const recovered = await handler(new Request("http://localhost/workspaces/demo"));
    await expect(recovered.text()).resolves.toBe("<main>Late build</main>");
  });
});
