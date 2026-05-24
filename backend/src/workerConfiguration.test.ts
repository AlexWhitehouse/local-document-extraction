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
});
