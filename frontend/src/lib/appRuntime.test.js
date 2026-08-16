import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppRuntimeCore,
  createWorkspaceRequestLayer,
} from "./appRuntime.js";

describe("app runtime requests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends authenticated Workspace requests with session credentials and records the response", async () => {
    const setLatestResponse = vi.fn();
    const core = createAppRuntimeCore({
      apiBase: "/v1/",
      setLatestResponse,
      setLogLines: vi.fn(),
      toast: { success: vi.fn(), error: vi.fn() },
    });
    const runtime = createWorkspaceRequestLayer({
      coreRequest: core.request,
      hasSession: true,
      workspaceId: " ws_1 ",
      onForbiddenWorkspaceAccess: vi.fn(),
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ templates: [{ id: "tpl_1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const data = await runtime.request("/templates", { method: "GET" });

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(globalThis.fetch).toHaveBeenCalledWith("/v1/templates", {
      method: "GET",
      headers: expect.any(Headers),
      credentials: "include",
    });
    expect(options.headers.get("x-workspace-id")).toBe("ws_1");
    expect(data).toEqual({ templates: [{ id: "tpl_1" }] });
    expect(setLatestResponse).toHaveBeenCalledWith({ templates: [{ id: "tpl_1" }] });
  });

  it("returns binary responses without decoding or recording workbook bytes", async () => {
    const setLatestResponse = vi.fn();
    const core = createAppRuntimeCore({
      apiBase: "/v1",
      setLatestResponse,
      setLogLines: vi.fn(),
      toast: { success: vi.fn(), error: vi.fn() },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("xlsx-bytes", {
        status: 200,
        headers: { "x-exported-job-count": "2" },
      }),
    );

    const result = await core.request("/jobs/export", {
      method: "POST",
      responseType: "blob",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/v1/jobs/export", {
      method: "POST",
      credentials: "include",
    });
    expect(await result.blob.text()).toBe("xlsx-bytes");
    expect(result.headers.get("x-exported-job-count")).toBe("2");
    expect(setLatestResponse).not.toHaveBeenCalled();
  });

  it("treats a conditional 304 as a successful header-only response", async () => {
    const setLatestResponse = vi.fn();
    const core = createAppRuntimeCore({
      apiBase: "/v1",
      setLatestResponse,
      setLogLines: vi.fn(),
      toast: { success: vi.fn(), error: vi.fn() },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: 'W/"job-v1-tag"' } }),
    );

    const result = await core.request("/jobs/job_1", {
      method: "GET",
      responseType: "conditional-json",
    });

    expect(result).toMatchObject({ data: null, notModified: true, status: 304 });
    expect(result.headers.get("etag")).toBe('W/"job-v1-tag"');
    expect(setLatestResponse).not.toHaveBeenCalled();
  });
});
