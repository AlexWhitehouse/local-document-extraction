import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

describe("Domain documentation", () => {
  it("documents Workspace context invalidation as a live update HTTP revalidation contract", async () => {
    const backendContext = await readFile(new URL("../CONTEXT.md", import.meta.url), "utf8");
    const frontendContext = await readFile(new URL("../../frontend/CONTEXT.md", import.meta.url), "utf8");

    for (const context of [backendContext, frontendContext]) {
      expect(context).toContain("**Workspace context invalidation**");
      expect(context).toContain("**Workspace live updates** are not durable history");
      expect(context).toContain("revalidate");
    }

    expect(backendContext).toContain("reason code");
    expect(backendContext).toContain("**Local product analytics log**");
    expect(backendContext).toContain("account identity");
    expect(backendContext).toContain("extracted answers");
    expect(backendContext).toContain("evidence text");
    expect(backendContext).toContain("Source file binary contents");
    expect(backendContext).toContain("Document contents");

    expect(frontendContext).toContain("selected accepted **Workspace context**");
    expect(frontendContext).toContain("bounded");
    expect(frontendContext).toContain("full Workspace-list refresh");
  });
});
