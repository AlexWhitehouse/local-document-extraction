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
    expect(toast.success).toHaveBeenCalledWith("Profile updated", expect.anything());
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't sign out. Try again.", expect.anything()));
    expect(props.onClearSessionWorkspaceData).not.toHaveBeenCalled();
    expect(result.current.profileMenu.isSigningOut).toBe(false);
  });

  it("marks only sign out as pending while the request runs", async () => {
    let finishSignOut;
    authClient.signOut.mockImplementation(() => new Promise((resolve) => (finishSignOut = resolve)));
    const { result } = renderProfile(authClient);

    let signOut;
    act(() => {
      signOut = result.current.profileMenu.onSignOut();
    });

    expect(result.current.profileMenu.isSigningOut).toBe(true);
    expect(result.current.authScreen.isAuthPending).toBe(false);

    await act(async () => {
      finishSignOut();
      await signOut;
    });

    expect(result.current.profileMenu.isSigningOut).toBe(false);
  });
});

describe("auth form feedback", () => {
  function renderAuth(authClient, initialAuthMode = "signin") {
    const toast = { error: vi.fn(), success: vi.fn() };

    const props = {
      toast,
      authClient,
      refetchSession: vi.fn(async () => {}),
      initialAuthMode,
      hasSession: false,
      sessionUserName: "",
      sessionUserEmail: "",
      onClearWorkspaceScopedTemplates: vi.fn(),
      onClearWorkspaceScopedDocuments: vi.fn(),
      onClearSessionWorkspaceData: vi.fn(),
    };

    const { result } = renderHook(() => useAuthProfileController(props));

    return { result, toast, props };
  }

  const event = () => ({ preventDefault: vi.fn() });

  it("shows field errors under empty sign-in fields without a toast or auth call", async () => {
    const authClient = { signIn: { email: vi.fn() } };
    const { result, toast } = renderAuth(authClient);

    await act(async () => result.current.authScreen.onSubmit(event()));

    expect(authClient.signIn.email).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.authScreen.fieldErrors).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(result.current.authScreen.focusRequest).toEqual({ field: "email" });
  });

  it("shows a form-level message when sign-in is rejected and keeps the email", async () => {
    const authClient = { signIn: { email: vi.fn(async () => ({ error: { message: "Invalid credentials" } })) } };
    const { result, toast } = renderAuth(authClient);

    act(() => result.current.authScreen.onEmailChange("ada@example.com"));
    act(() => result.current.authScreen.onPasswordChange("wrong"));
    await act(async () => result.current.authScreen.onSubmit(event()));

    expect(result.current.authScreen.formError).toBe("Sign in failed. Check your email and password and try again.");
    expect(result.current.authScreen.email).toBe("ada@example.com");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports a sign-up mismatch under the confirm field without calling auth", async () => {
    const authClient = { signUp: { email: vi.fn() } };
    const { result, toast } = renderAuth(authClient, "signup");

    act(() => result.current.authScreen.onNameChange("Ada"));
    act(() => result.current.authScreen.onEmailChange("ada@example.com"));
    act(() => result.current.authScreen.onPasswordChange("Passw0rd!"));
    act(() => result.current.authScreen.onConfirmPasswordChange("Other0rd!"));
    await act(async () => result.current.authScreen.onSubmit(event()));

    expect(authClient.signUp.email).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.authScreen.fieldErrors).toEqual({ confirmPassword: "Passwords do not match." });
  });

  it("clears a field error when that field changes", async () => {
    const { result } = renderAuth({ signIn: { email: vi.fn() } });

    await act(async () => result.current.authScreen.onSubmit(event()));
    act(() => result.current.authScreen.onEmailChange("a"));

    expect(result.current.authScreen.fieldErrors).toEqual({ password: "Enter your password." });
  });
});
