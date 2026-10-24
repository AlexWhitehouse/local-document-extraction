import { describe, expect, it, vi } from "vitest";
import { createWorkspaceRequestAdapter, readInvitationDelivery, readResendRetryAfter } from "./workspaceRequestAdapter";

const invitation = { id: "inv_1", email: "grace@example.com", invite_url: "https://studio.example.com/invitations/inv_1" };

describe("Workspace invitation requests", () => {
  it("creates an invitation and splits off its email outcome", async () => {
    const request = vi.fn().mockResolvedValue({ ...invitation, email_delivery: { status: "captured" } });
    const adapter = createWorkspaceRequestAdapter({ request });

    await expect(
      adapter.createWorkspaceInvitation({ workspaceId: " ws 1 ", email: "grace@example.com", role: "admin" }),
    ).resolves.toEqual({ invitation, delivery: "captured" });
    expect(request).toHaveBeenCalledWith("/workspaces/ws%201/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "grace@example.com", role: "admin" }),
    });
  });

  it("resends an invitation's email through its resend action", async () => {
    const request = vi.fn().mockResolvedValue({ ...invitation, email_delivery: { status: "sent" } });
    const adapter = createWorkspaceRequestAdapter({ request });

    await expect(adapter.resendWorkspaceInvitation({ workspaceId: "ws_1", invitationId: "inv/1" })).resolves.toEqual({
      invitation,
      delivery: "sent",
    });
    expect(request).toHaveBeenCalledWith(
      "/workspaces/ws_1/invitations/inv%2F1",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend" }) },
      true,
      false,
    );
  });

  it("requires an invitation to resend", async () => {
    const request = vi.fn();
    const adapter = createWorkspaceRequestAdapter({ request });

    await expect(adapter.resendWorkspaceInvitation({ workspaceId: "ws_1", invitationId: " " })).rejects.toThrow(
      "Invitation ID is required",
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe("readInvitationDelivery", () => {
  it.each(["sent", "captured", "failed", "rate_limited"])("keeps the %s outcome", (status) => {
    expect(readInvitationDelivery({ ...invitation, email_delivery: { status } }).delivery).toBe(status);
  });

  it.each([
    ["an older server", invitation],
    ["an unknown outcome", { ...invitation, email_delivery: { status: "queued" } }],
    ["a malformed outcome", { ...invitation, email_delivery: "sent" }],
  ])("reads %s as unknown", (_, result) => {
    expect(readInvitationDelivery(result)).toEqual({ invitation, delivery: "unknown" });
  });

  it("tolerates an empty response", () => {
    expect(readInvitationDelivery(null)).toEqual({ invitation: {}, delivery: "unknown" });
  });
});

describe("readResendRetryAfter", () => {
  const refused = (details) => Object.assign(new Error("limit"), { status: 429, details });

  it("reads the wait in seconds", () => {
    expect(readResendRetryAfter(refused({ code: "invitation_email_rate_limited", retry_after_seconds: 540 }))).toBe(540);
  });

  it("reads null as no resends left", () => {
    expect(readResendRetryAfter(refused({ code: "invitation_email_rate_limited", retry_after_seconds: null }))).toBeNull();
  });

  it.each([[{}], [{ retry_after_seconds: "540" }], [{ retry_after_seconds: -1 }], [null]])(
    "reads %j as unknown",
    (details) => {
      expect(readResendRetryAfter(refused(details))).toBeUndefined();
    },
  );
});
