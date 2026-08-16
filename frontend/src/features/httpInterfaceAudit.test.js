import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cwd } from "node:process";

import { describe, expect, it, vi } from "vitest";

import { createDocumentRequestAdapter } from "./documents/documentRequestAdapter.js";
import { createWorkspaceRequestAdapter } from "./workspaces/workspaceRequestAdapter.js";

describe("in-scope HTTP interface audit", () => {
  it("keeps Workspace and Document route construction in domain adapters", async () => {
    const request = vi.fn(async (path, options) => {
      if (path === "/jobs" || path.startsWith("/jobs?")) {
        return { jobs: [], total: 0, next_cursor: null, has_more: false };
      }
      if (path === "/jobs/filter-options") {
        return { available_models: ["provider/model"] };
      }
      if (path === "/jobs/job_1" && options.method === "DELETE") {
        return { deleted: true, job_id: "job_1" };
      }
      if (path === "/jobs/job_1") {
        return { job_id: "job_1", status: "completed" };
      }
      if (path === "/jobs/export") {
        return {
          blob: new Blob(["xlsx"]),
          headers: new Headers({
            "content-disposition": 'attachment; filename="workspace-job-export.xlsx"',
            "x-exported-job-count": "1",
            "x-skipped-job-count": "0",
          }),
        };
      }
      if (path === "/workspaces/ws_1" && options.method === "DELETE") {
        return { ok: true, workspace_id: "ws_1" };
      }
      if (path === "/workspaces/ws_1/users") {
        return { users: [] };
      }
      if (path === "/workspaces/ws_1/invitations") {
        return { invitations: [] };
      }
      if (path === "/workspaces/ws_1/leave") {
        return { ok: true, workspace_id: "ws_1", next_workspace: { id: "ws_2" } };
      }
      return { workspace_id: "ws_1", user_id: "user_2", action: "make_admin", role: "admin" };
    });
    const documentRequests = createDocumentRequestAdapter({ request });
    const workspaceRequests = createWorkspaceRequestAdapter({ request });

    await expect(documentRequests.getFilterOptions()).resolves.toEqual({
      available_models: ["provider/model"],
    });
    await documentRequests.getDocument("job_1");
    await documentRequests.listDocuments({
      search: "invoice",
      cursor: "cursor_1",
      filters: {
        dateFrom: "2026-08-01",
        dateTo: "2026-08-16",
        model: "provider/model",
      },
    });
    await documentRequests.deleteDocument("job_1");
    await expect(documentRequests.exportDocuments(["job_1", "job_1"])).resolves.toMatchObject({
      filename: "workspace-job-export.xlsx",
      exportedCount: 1,
      skippedCount: 0,
    });
    await documentRequests.submitDocument(new FormData());
    await workspaceRequests.deleteWorkspace("ws_1");
    await workspaceRequests.listWorkspaceUsers("ws_1");
    await workspaceRequests.applyWorkspaceMemberAction({ workspaceId: "ws_1", targetUserId: "user_2", action: "make_admin" });
    await workspaceRequests.listWorkspaceInvitations("ws_1");
    await workspaceRequests.leaveWorkspace("ws_1");

    expect(request.mock.calls.map(([path, options]) => [path, options.method])).toEqual([
      ["/jobs/filter-options", "GET"],
      ["/jobs/job_1", "GET"],
      ["/jobs?search=invoice&date_from=2026-08-01&date_to=2026-08-16&model=provider%2Fmodel&cursor=cursor_1", "GET"],
      ["/jobs/job_1", "DELETE"],
      ["/jobs/export", "POST"],
      ["/extract", "POST"],
      ["/workspaces/ws_1", "DELETE"],
      ["/workspaces/ws_1/users", "GET"],
      ["/workspaces/ws_1/users/user_2", "POST"],
      ["/workspaces/ws_1/invitations", "GET"],
      ["/workspaces/ws_1/leave", "POST"],
    ]);
  });

  it("rejects the former custom profile-route dependency and controller-side Document paths", async () => {
    const sources = await Promise.all([
      readFile(resolve(cwd(), "src/features/documents/documentRequestAdapter.js"), "utf8"),
      readFile(resolve(cwd(), "src/features/documents/useDocumentController.js"), "utf8"),
      readFile(resolve(cwd(), "src/features/workspaces/workspaceRequestAdapter.js"), "utf8"),
      readFile(resolve(cwd(), "src/features/auth/useAuthProfileController.js"), "utf8"),
    ]);
    const source = sources.join("\n");

    expect(source).not.toMatch(/["'`]\/profile(?:["'`/?]|$)/);
    expect(sources[1]).not.toContain("/jobs/");
    expect(sources[1]).not.toContain('"/extract"');
  });
});
