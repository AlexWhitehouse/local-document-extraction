import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Worker configuration", () => {
  it("exposes the EMAIL binding through real Cloudflare Email Sending in local development", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.send_email).toContainEqual({
      name: "EMAIL",
      remote: true,
    });
  });

  it("configures the Workspace product store as a SQLite-backed Durable Object", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.durable_objects?.bindings).toContainEqual({
      name: "WORKSPACE_PRODUCT_STORE",
      class_name: "WorkspaceProductStore",
    });
    expect(config.migrations).toContainEqual({
      tag: "v1_workspace_product_store",
      new_sqlite_classes: ["WorkspaceProductStore"],
    });
  });

  it("exposes Workspace product analytics through Workers Analytics Engine", async () => {
    const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = Function(`"use strict"; return (${configText});`)();

    expect(config.analytics_engine_datasets).toContainEqual({
      binding: "WORKSPACE_PRODUCT_ANALYTICS",
      dataset: "workspace_product_analytics",
    });
  });
});
