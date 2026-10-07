import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthProfileController } from "./useAuthProfileController.js";

function renderProfile(authClient) {
  const toast = { error: vi.fn(), success: vi.fn() };

  const props = {
    toast,
    authClient,
    refetchSession: vi.fn(async () => {}),
    hasSession: true,
    sessionUserName: "Ada Lovelace",
    sessionUserEmail: "ada@example.com",
    busy: false,
    setBusy: vi.fn(),
    onClearWorkspaceScopedTemplates: vi.fn(),
    onClearWorkspaceScopedDocuments: vi.fn(),
    onClearSessionWorkspaceData: vi.fn(),
  };

  const { result } = renderHook(() => useAuthProfileController(props));

  act(() => result.current.profileMenu.onToggle());

  return { props, toast, result };
}

describe("profile menu feedback", () => {
  let authClient;

  beforeEach(() => {
    authClient = { updateUser: vi.fn(async () => ({ data: { name: "Ada Byron" } })), signOut: vi.fn(async () => {}) };
  });

  it("disables saving while the trimmed name is blank", () => {
    const { result } = renderProfile(authClient);

    act(() => result.current.profileMenu.onDraftNameChange("   "));

    expect(result.current.profileMenu.canSaveProfile).toBe(false);
    expect(result.current.profileMenu.isDirty).toBe(true);
  });

  it("reports a successful save with a toast and closes the menu", async () => {
    const { result, toast } = renderProfile(authClient);

    act(() => result.current.profileMenu.onDraftNameChange("Ada Byron"));
    await act(async () => result.current.profileMenu.onSaveProfile());

    expect(authClient.updateUser).toHaveBeenCalledWith({ name: "Ada Byron" });
    expect(toast.success).toHaveBeenCalledWith("Profile updated");
    expect(result.current.profileMenu.isOpen).toBe(false);
  });

  it("keeps the menu open and shows an inline error when saving fails", async () => {
    authClient.updateUser.mockResolvedValue({ error: { message: "<html>502 Bad Gateway</html>" } });
    const { result, toast } = renderProfile(authClient);

    act(() => result.current.profileMenu.onDraftNameChange("Ada Byron"));
    await act(async () => result.current.profileMenu.onSaveProfile());

    expect(result.current.profileMenu.saveError).toBe("Profile could not be saved. Please try again.");
    expect(result.current.profileMenu.isOpen).toBe(true);
    expect(result.current.profileMenu.draftName).toBe("Ada Byron");
    expect(toast.success).not.toHaveBeenCalled();

    act(() => result.current.profileMenu.onDraftNameChange("Ada B."));

    expect(result.current.profileMenu.saveError).toBe("");
  });

  it("shows a failure toast when sign out fails and keeps the session", async () => {
    authClient.signOut.mockRejectedValue(new Error("network down"));
    const { props, result, toast } = renderProfile(authClient);

    await act(async () => result.current.profileMenu.onSignOut());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't sign out. Try again."));
    expect(props.onClearSessionWorkspaceData).not.toHaveBeenCalled();
    expect(props.setBusy).toHaveBeenLastCalledWith(false);
  });
});
