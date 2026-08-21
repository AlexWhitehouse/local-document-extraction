import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authClientMock = vi.hoisted(() => ({
  useSession: vi.fn(),
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signUpEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
  refetchSession: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("./lib/authClient", () => ({
  createRuntimeAuthClient: () => ({
    useSession: authClientMock.useSession,
    signIn: {
      email: authClientMock.signInEmail,
      social: authClientMock.signInSocial,
    },
    signUp: {
      email: authClientMock.signUpEmail,
    },
    requestPasswordReset: authClientMock.requestPasswordReset,
    resetPassword: authClientMock.resetPassword,
    signOut: authClientMock.signOut,
  }),
}));

vi.mock("sonner", () => ({
  Toaster: (props) => (
    <div data-rich-colors={String(props.richColors)} data-testid="sonner-toaster" />
  ),
  toast: toastMock,
}));

import { App } from "./App.jsx";

describe("auth sign-in feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authClientMock.useSession.mockReturnValue({
      data: null,
      isPending: false,
      refetch: authClientMock.refetchSession,
    });
    window.history.replaceState(null, "", "/");
    const storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key) => storage.get(key) ?? null),
        setItem: vi.fn((key, value) => storage.set(key, String(value))),
        removeItem: vi.fn((key) => storage.delete(key)),
        clear: vi.fn(() => storage.clear()),
      },
    });
  });

  it("shows one error toast reporting all missing sign-in fields", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Email and password are required.",
    );
  });

  it("shows a generic safe error toast when email sign-in fails", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({
      error: { message: "No user exists for ada@example.com" },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Sign in failed. Check your email and password and try again.",
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining("ada@example.com"),
    );
  });

  it("tells an unverified email/password user to verify their email and that a new link was sent", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({
      error: { message: "Email not verified" },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Verify your email before signing in. We sent you a new Account verification link.",
    );
    expect(authClientMock.refetchSession).not.toHaveBeenCalled();
  });

  it("shows a generic safe error toast when Google sign-in cannot start", async () => {
    const user = userEvent.setup();
    authClientMock.signInSocial.mockResolvedValue({
      error: { message: "OAuth client_id is invalid" },
    });

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Google sign-in could not start. Please try again.",
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining("OAuth"),
    );
  });

  it("submits sign-in when Enter is pressed in the sign-in form", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({ error: null });

    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "valid-password{Enter}");

    expect(screen.getByLabelText("Password").value).toBe("");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("renders one rich-colors Sonner toaster on the auth screen", () => {
    render(<App />);

    const toasters = screen.getAllByTestId("sonner-toaster");
    expect(toasters).toHaveLength(1);
    expect(toasters[0].dataset.richColors).toBe("true");
  });

  it("does not initialize auth form values from Stored workspace preference", async () => {
    window.localStorage.getItem.mockReturnValue(
      JSON.stringify({
        workspaceId: "ws_1",
        workspaceName: "Research Workspace",
        authName: "Ada Lovelace",
        authEmail: "ada@example.com",
      }),
    );

    render(<App />);

    expect(screen.getByLabelText("Email").value).toBe("");

    await userEvent.click(screen.getByRole("link", { name: "Sign Up" }));

    expect(screen.getByLabelText("Name").value).toBe("");
    expect(screen.getByLabelText("Email").value).toBe("");
  });

  it("ignores the legacy Image Extraction workspace storage key", () => {
    const legacyValue = JSON.stringify({
      workspaceId: "legacy_ws",
      workspaceName: "Legacy Workspace",
      authEmail: "legacy@example.com",
    });
    window.localStorage.getItem.mockImplementation((key) =>
      key === "imageextraction.workspace.v1" ? legacyValue : null,
    );

    render(<App />);

    expect(window.localStorage.getItem).toHaveBeenCalledWith(
      "documentextraction.workspace.v1",
    );
    expect(window.localStorage.getItem).not.toHaveBeenCalledWith(
      "imageextraction.workspace.v1",
    );
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
      "documentextraction.workspace.v1",
      legacyValue,
    );
    expect(screen.getByLabelText("Email").value).toBe("");
  });

  it("opens Account password reset request mode from sign-in while preserving the typed email", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("link", { name: "Forgot password?" }));

    expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("shows feedback and does not call auth when Account password reset request email is missing", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Forgot password?" }));
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith("Email is required.");
    expect(authClientMock.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("shows Account password reset recovery when the reset link has no token", async () => {
    window.history.replaceState(null, "", "/reset-password");

    render(<App />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Reset link is missing or invalid" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Request a new Account password reset link to continue."),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Request a new reset link" }),
    ).toBeTruthy();
  });

  it("shows Account password reset recovery when Better Auth reports a token error", async () => {
    window.history.replaceState(
      null,
      "",
      "/reset-password?error=invalid_token",
    );

    render(<App />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "Reset link has expired or is invalid",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This Account password reset link can no longer be used.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Request a new reset link" }),
    ).toBeTruthy();
  });

  it("opens Account password reset request mode from a reset link recovery state", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password");

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Request a new reset link" }),
    );

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("shows a new-password form when an Account password reset token is present", () => {
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Set new password" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Set new password" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /Reset link/i }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("blocks Account password reset submission until the new password satisfies policy", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App />);

    await user.type(screen.getByLabelText("New password"), "password");

    expect(screen.queryByText("At least 8 characters")).toBeNull();
    expect(screen.getByText("One uppercase letter")).toBeTruthy();
    expect(screen.getByText("One number")).toBeTruthy();
    expect(screen.getByText("One special character")).toBeTruthy();

    await user.type(screen.getByLabelText("Confirm new password"), "password");
    await user.click(screen.getByRole("button", { name: "Set new password" }));

    expect(authClientMock.resetPassword).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Password must meet all complexity requirements.",
    );
  });

  it("blocks Account password reset when confirmation does not match", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App />);

    const newPasswordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");

    await user.type(newPasswordInput, "Password1!");
    await user.type(confirmPasswordInput, "Password2!");

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(newPasswordInput.getAttribute("aria-invalid")).toBe("true");
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Set new password" }));

    expect(authClientMock.resetPassword).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith("Passwords do not match.");
  });

});

describe("auth sign-up password policy feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authClientMock.useSession.mockReturnValue({
      data: null,
      isPending: false,
      refetch: authClientMock.refetchSession,
    });
    window.history.replaceState(null, "", "/");
    const storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key) => storage.get(key) ?? null),
        setItem: vi.fn((key, value) => storage.set(key, String(value))),
        removeItem: vi.fn((key) => storage.delete(key)),
        clear: vi.fn(() => storage.clear()),
      },
    });
  });

  it("requires confirm password for sign-up without sending it to auth", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ error: null });

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));

    expect(screen.getByLabelText("Confirm Password")).toBeTruthy();

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Confirm password is required.",
    );

    toastMock.error.mockClear();

    await user.type(screen.getByLabelText("Confirm Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Check your email to verify your account.")).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows password mismatch feedback until sign-up passwords match", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));

    const passwordInput = screen.getByLabelText("Password");
    const confirmPasswordInput = screen.getByLabelText("Confirm Password");

    await user.type(confirmPasswordInput, "Password1!");

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(passwordInput.getAttribute("aria-invalid")).toBe("true");
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput.className).toContain("auth-input-error");
    expect(confirmPasswordInput.className).toContain("auth-input-error");

    await user.type(passwordInput, "Password1!");

    expect(screen.queryByText("Passwords do not match.")).toBeNull();
    expect(passwordInput.getAttribute("aria-invalid")).toBe("false");
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBe("false");
    expect(passwordInput.className).not.toContain("auth-input-error");
    expect(confirmPasswordInput.className).not.toContain("auth-input-error");
  });

  it("blocks sign-up with mismatched passwords and shows one error toast", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm Password"), "Password2!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith("Passwords do not match.");
  });

  it("clears password validation state when switching auth modes while preserving identity fields", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm Password"), "Password2!");

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Sign In" }));

    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.getByLabelText("Password").value).toBe("");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Sign Up" }));

    expect(screen.getByLabelText("Name").value).toBe("Ada Lovelace");
    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.getByLabelText("Password").value).toBe("");
    expect(screen.getByLabelText("Confirm Password").value).toBe("");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
    expect(screen.queryByText("At least 8 characters")).toBeNull();
  });

  it("submits account creation when Enter is pressed in the sign-up form", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ error: null });

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(
      screen.getByLabelText("Confirm Password"),
      "Password1!{Enter}",
    );

    expect(screen.getByText("Check your email to verify your account.")).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows only unmet account password policy requirements while composing a sign-up password", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));

    expect(screen.queryByText("At least 8 characters")).toBeNull();

    await user.type(screen.getByLabelText("Password"), "abc");

    expect(screen.getByText("At least 8 characters")).toBeTruthy();
    expect(screen.getByText("One uppercase letter")).toBeTruthy();
    expect(screen.getByText("One number")).toBeTruthy();
    expect(screen.getByText("One special character")).toBeTruthy();

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Password1!");

    expect(screen.queryByText("At least 8 characters")).toBeNull();
    expect(screen.queryByText("One uppercase letter")).toBeNull();
    expect(screen.queryByText("One number")).toBeNull();
    expect(screen.queryByText("One special character")).toBeNull();
  });

  it("blocks sign-up with an unmet account password policy and shows one error toast", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.type(screen.getByLabelText("Confirm Password"), "password");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Password must meet all complexity requirements.",
    );
  });

  it("shows one error toast reporting all missing sign-up fields", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Name, email, password, and confirm password are required.",
    );
  });

  it("shows an actionable toast when sign-up email is already in use", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({
      error: { message: "User already exists for ada@example.com" },
    });

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "An account already exists for this email. Sign in instead.",
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining("ada@example.com"),
    );
  });

  it("shows an actionable toast when sign-up email is invalid", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({
      error: { message: "Invalid email address" },
    });

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Enter a valid email address and try again.",
    );
  });

  it("shows a generic safe toast when sign-up fails for an unknown reason", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({
      error: { message: "Database constraint failed near secret_table" },
    });

    render(<App />);

    await user.click(screen.getByRole("link", { name: "Sign Up" }));
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.type(screen.getByLabelText("Confirm Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(toastMock.error).toHaveBeenCalledOnce();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Account creation failed. Please try again.",
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Database"),
    );
  });
});
