import { toast as realToast } from "sonner";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const authClientMock = {
  useSession: vi.fn(),
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signUpEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
  refetchSession: vi.fn(),
};

const toastMock = {
  error: vi.fn(),
  success: vi.fn(),
};

const createAuthClient = () => ({
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
});

import { App } from "./App.jsx";
import { DEFAULT_RUNTIME_CONFIGURATION } from "./lib/runtimeConfiguration";

// These existing cases exercise deployments with Google and delivered email.
const configuration = {
  ...DEFAULT_RUNTIME_CONFIGURATION,
  auth: {
    ...DEFAULT_RUNTIME_CONFIGURATION.auth,
    googleEnabled: true,
    requireEmailVerification: true,
    mailDelivery: "cloudflare",
  },
};

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

async function fillSignUp(user, { name = "Ada Lovelace", password = "Password1!", confirmPassword = password } = {}) {
  await user.click(screen.getByRole("button", { name: "Sign up" }));
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmPassword);
}

describe("auth sign-in feedback", () => {
  it("keeps the app frame with a loading status while the session loads, without the sign-in form", () => {
    authClientMock.useSession.mockReturnValue({ data: null, isPending: true, refetch: authClientMock.refetchSession });

    const { container } = render(
      <App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />,
    );

    expect(container.querySelector(".app-frame")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("shows field errors under empty sign-in fields without a toast", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Email")).toBe(document.activeElement);
  });

  it("shows a form-level alert when email sign-in fails", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({
      error: { message: "No user exists for ada@example.com" },
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Sign in failed. Check your email and password and try again.",
    );
    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
  });

  it("tells an unverified email/password user to verify their email and that a new link was sent", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({
      error: { message: "Email not verified" },
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Verify your email before signing in. We sent you a new account verification link.",
    );
    expect(authClientMock.refetchSession).not.toHaveBeenCalled();
  });

  it("shows a form-level alert when Google sign-in cannot start", async () => {
    const user = userEvent.setup();
    authClientMock.signInSocial.mockResolvedValue({
      error: { message: "OAuth client_id is invalid" },
    });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't start Google sign-in. Try again.");
    expect(screen.getByRole("alert").textContent).not.toContain("OAuth");
  });

  it.each([
    ["/workspaces/ws_1/templates/tpl_1", "/workspaces/ws_1/templates/tpl_1"],
    ["/reset-password?error=invalid_token", ""],
  ])("uses a usable Google sign-in callback from %s", async (path, callbackPath) => {
    window.history.replaceState(null, "", path);
    authClientMock.signInSocial.mockResolvedValue({ error: null });
    render(
      <App
        createAuthClient={createAuthClient}
        notifications={toastMock}
        configuration={{ ...configuration, auth: { ...configuration.auth, emailPasswordEnabled: false } }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(authClientMock.signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: window.location.origin + callbackPath,
    });
  });

  it("submits sign-in when Enter is pressed in the sign-in form", async () => {
    const user = userEvent.setup();
    authClientMock.signInEmail.mockResolvedValue({ error: null });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "valid-password{Enter}");

    expect(screen.getByLabelText("Password").value).toBe("");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("renders one rich-colors Sonner toaster on the auth screen", async () => {
    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);
    let toastId;
    await act(async () => {
      toastId = realToast.success("Toast appearance test");
    });

    try {
      const message = await screen.findByText("Toast appearance test");
      expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
      expect(message.closest("[data-sonner-toast]").dataset.richColors).toBe("true");
    } finally {
      act(() => {
        realToast.dismiss(toastId);
      });
    }
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

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    expect(screen.getByLabelText("Email").value).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

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

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    expect(window.localStorage.getItem).toHaveBeenCalledWith("documentextraction.workspace.v1");
    expect(window.localStorage.getItem).not.toHaveBeenCalledWith("imageextraction.workspace.v1");
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith("documentextraction.workspace.v1", legacyValue);
    expect(screen.getByLabelText("Email").value).toBe("");
  });

  it("opens Account password reset request mode from sign-in while preserving the typed email", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("shows a field error and does not call auth when Account password reset request email is missing", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(authClientMock.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("shows Account password reset recovery when the reset link has no token", async () => {
    window.history.replaceState(null, "", "/reset-password");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Reset link is missing or invalid" })).toBeTruthy();
    expect(screen.getByText("Request a new link to continue.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Request a new reset link" })).toBeTruthy();
  });

  it("shows Account password reset recovery when Better Auth reports a token error", async () => {
    window.history.replaceState(null, "", "/reset-password?error=invalid_token");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "Reset link has expired or is invalid",
      }),
    ).toBeTruthy();
    expect(screen.getByText("This link has expired or was already used.")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Request a new reset link" })).toBeTruthy();
  });

  it("opens Account password reset request mode from a reset link recovery state", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Request a new reset link" }));

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("shows a new-password form when an Account password reset token is present", () => {
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    expect(authClientMock.useSession).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Set new password" })).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set new password" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Reset link/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("blocks Account password reset submission until the new password satisfies policy", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.type(screen.getByLabelText("New password"), "password");

    expect(screen.queryByText("At least 8 characters")).toBeNull();
    expect(screen.getByText("One uppercase letter")).toBeTruthy();
    expect(screen.getByText("One number")).toBeTruthy();
    expect(screen.getByText("One special character")).toBeTruthy();

    await user.type(screen.getByLabelText("Confirm new password"), "password");
    await user.click(screen.getByRole("button", { name: "Set new password" }));

    expect(authClientMock.resetPassword).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Password doesn't meet all the requirements below.")).toBeTruthy();
  });

  it("blocks Account password reset when confirmation does not match", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/reset-password?token=abc123");

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    const newPasswordInput = screen.getByLabelText("New password");
    const confirmPasswordInput = screen.getByLabelText("Confirm new password");

    await user.type(newPasswordInput, "Password1!");
    await user.type(confirmPasswordInput, "Password2!");
    await user.tab();

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBe("true");
    expect(confirmPasswordInput.getAttribute("aria-describedby")).toBe("reset-confirm-password-error");

    await user.click(screen.getByRole("button", { name: "Set new password" }));

    expect(authClientMock.resetPassword).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe("auth sign-up password policy feedback", () => {
  it("requires confirm password for sign-up without sending it to auth", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ error: null });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByLabelText("Confirm password")).toBeTruthy();

    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm your password.")).toBeTruthy();

    await user.type(screen.getByLabelText("Confirm password"), "Password1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Check your email to verify your account")).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows password mismatch feedback until sign-up passwords match", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    const passwordInput = screen.getByLabelText("Password");
    const confirmPasswordInput = screen.getByLabelText("Confirm password");

    await user.type(confirmPasswordInput, "Password1!");
    await user.tab();

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBe("true");
    expect(confirmPasswordInput.getAttribute("aria-describedby")).toContain("-error");

    await user.type(passwordInput, "Password1!");

    expect(screen.queryByText("Passwords do not match.")).toBeNull();
    expect(confirmPasswordInput.getAttribute("aria-invalid")).toBeNull();
    expect(confirmPasswordInput.getAttribute("aria-describedby")).toBeNull();
  });

  it("shows the mismatch under the confirm field when sign-up is submitted", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await fillSignUp(user, { confirmPassword: "Password2!" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password").getAttribute("aria-invalid")).toBe("true");
  });

  it("clears password validation state when switching auth modes while preserving identity fields", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await fillSignUp(user, { confirmPassword: "Password2!" });
    await user.tab();

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.getByLabelText("Password").value).toBe("");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByLabelText("Name").value).toBe("Ada Lovelace");
    expect(screen.getByLabelText("Email").value).toBe("ada@example.com");
    expect(screen.getByLabelText("Password").value).toBe("");
    expect(screen.getByLabelText("Confirm password").value).toBe("");
    expect(screen.queryByText("Passwords do not match.")).toBeNull();
    expect(screen.queryByText("At least 8 characters")).toBeNull();
  });

  it("submits account creation when Enter is pressed in the sign-up form", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ error: null });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await fillSignUp(user, { confirmPassword: "Password1!{Enter}" });

    expect(screen.getByText("Check your email to verify your account")).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows only unmet account password policy requirements while composing a sign-up password", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.queryByText("At least 8 characters")).toBeNull();

    await user.type(screen.getByLabelText("Password"), "abc");

    expect(screen.getByText("At least 8 characters")).toBeTruthy();
    expect(screen.getByText("One uppercase letter")).toBeTruthy();
    expect(screen.getByText("One number")).toBeTruthy();
    expect(screen.getByText("One special character")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("aria-describedby")).toBe("auth-password-requirements");

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "Password1!");

    expect(screen.queryByText("At least 8 characters")).toBeNull();
    expect(screen.queryByText("One uppercase letter")).toBeNull();
    expect(screen.queryByText("One number")).toBeNull();
    expect(screen.queryByText("One special character")).toBeNull();
  });

  it("blocks sign-up with an unmet account password policy and shows an inline error", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await fillSignUp(user, { password: "password" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Password doesn't meet all the requirements below.")).toBeTruthy();
  });

  it("shows field errors for every missing sign-up field without a toast", async () => {
    const user = userEvent.setup();

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter a password.")).toBeTruthy();
    expect(screen.getByText("Confirm your password.")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBe(document.activeElement);
  });

  it.each([
    [
      "the email is already in use",
      "User already exists for ada@example.com",
      "An account already exists for this email. Sign in instead.",
    ],
    ["the email is invalid", "Invalid email address", "Enter a valid email address and try again."],
    ["an unknown reason", "Database constraint failed near secret_table", "Couldn't create account. Try again."],
  ])("shows one safe, actionable form alert when sign-up fails because %s", async (_reason, serverMessage, alertMessage) => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ error: { message: serverMessage } });

    render(<App createAuthClient={createAuthClient} notifications={toastMock} configuration={configuration} />);

    await fillSignUp(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(toastMock.error).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe(alertMessage);
    expect(screen.getByRole("alert").textContent).not.toContain("ada@example.com");
    expect(screen.getByRole("alert").textContent).not.toContain("Database");
  });
});

describe("deployment auth configuration", () => {
  it("hides unconfigured providers and closed registration", () => {
    render(
      <App
        createAuthClient={createAuthClient}
        notifications={toastMock}
        configuration={{
          ...DEFAULT_RUNTIME_CONFIGURATION,
          auth: { ...DEFAULT_RUNTIME_CONFIGURATION.auth, signupEnabled: false },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign up" })).toBeNull();
    expect(screen.getByText(/Account registration is closed/)).toBeTruthy();
  });

  it("shows only Google for a provider-only deployment", () => {
    render(
      <App
        createAuthClient={createAuthClient}
        notifications={toastMock}
        configuration={{ ...configuration, auth: { ...configuration.auth, emailPasswordEnabled: false } }}
      />,
    );
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Forgot password?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  });

  it("explains local verification when explicitly enabled", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ data: { user: { email: "ada@example.com" } } });
    render(
      <App
        createAuthClient={createAuthClient}
        notifications={toastMock}
        configuration={{
          ...DEFAULT_RUNTIME_CONFIGURATION,
          auth: { ...DEFAULT_RUNTIME_CONFIGURATION.auth, requireEmailVerification: true },
        }}
      />,
    );
    await fillSignUp(user, { name: "Ada" });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("heading", { name: "Verify your account" })).toBeTruthy();
    expect(screen.getByText("document-extraction mail")).toBeTruthy();
  });

  it("enters the session immediately with the default configuration", async () => {
    const user = userEvent.setup();
    authClientMock.signUpEmail.mockResolvedValue({ data: { user: { email: "ada@example.com" } } });
    render(<App createAuthClient={createAuthClient} notifications={toastMock} />);
    await fillSignUp(user, { name: "Ada" });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(authClientMock.refetchSession).toHaveBeenCalledOnce();
    expect(screen.queryByText(/verification link/)).toBeNull();
  });
});
