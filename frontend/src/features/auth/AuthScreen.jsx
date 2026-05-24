import React from "react";
import { Toaster } from "sonner";

export function AuthScreen({
  mode,
  name,
  email,
  password,
  confirmPassword,
  busy,
  hasPasswordMismatch,
  shouldShowPasswordRequirements,
  unmetPasswordRequirements,
  accountVerificationPromptEmail,
  onSubmit,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onPasswordTouched,
  onProviderSignIn,
  onSwitchMode,
}) {
  const isSignUp = mode === "signup";

  return (
    <>
      <Toaster richColors />
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
            <p>
              {mode === "signin"
                ? "Welcome back. Sign in to continue working in your workspace."
                : "Create your account to start extracting structured data from documents."}
            </p>
          </div>

          <div className="status-strip auth-status-strip">
            <span className="status-chip good">Secure auth</span>
            <span className="status-chip">Workspace-ready</span>
          </div>

          {accountVerificationPromptEmail ? (
            <div className="panel auth-verification-prompt" role="status">
              <h2>Check your email to verify your account.</h2>
              <p>
                We sent an Account verification link to{" "}
                <b>{accountVerificationPromptEmail}</b>. Open it to finish
                setting up your account.
              </p>
              <button
                type="button"
                className="auth-primary-action"
                disabled={busy}
                onClick={() => onSwitchMode("signin")}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form className="panel auth-panel" onSubmit={onSubmit}>
              <h2>{mode === "signin" ? "Sign in" : "Create account"}</h2>
              <p className="muted">
                Sign in first, then create or select a workspace.
              </p>
              <div
                className={
                  isSignUp ? "row two-up auth-form-grid" : "row auth-form-grid"
                }
              >
                {isSignUp ? (
                  <label>
                    Name
                    <input
                      value={name}
                      onChange={(event) => onNameChange(event.target.value)}
                      placeholder="Jane Doe"
                    />
                  </label>
                ) : null}
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    placeholder="jane@example.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    aria-invalid={hasPasswordMismatch}
                    className={hasPasswordMismatch ? "auth-input-error" : ""}
                    onChange={(event) => {
                      onPasswordChange(event.target.value);
                      if (isSignUp) {
                        onPasswordTouched();
                      }
                    }}
                    placeholder="************"
                  />
                </label>
                {isSignUp ? (
                  <label>
                    Confirm Password
                    <input
                      type="password"
                      value={confirmPassword}
                      aria-invalid={hasPasswordMismatch}
                      className={hasPasswordMismatch ? "auth-input-error" : ""}
                      onChange={(event) =>
                        onConfirmPasswordChange(event.target.value)
                      }
                      placeholder="Repeat password"
                    />
                  </label>
                ) : null}
              </div>
              {hasPasswordMismatch ? (
                <p className="auth-password-mismatch">
                  Passwords do not match.
                </p>
              ) : null}
              {shouldShowPasswordRequirements &&
              unmetPasswordRequirements.length > 0 ? (
                <ul className="auth-password-requirements">
                  {unmetPasswordRequirements.map((requirement) => (
                    <li key={requirement.label}>{requirement.label}</li>
                  ))}
                </ul>
              ) : null}
              {mode === "signin" ? (
                <>
                  <button
                    type="submit"
                    className="auth-primary-action"
                    disabled={busy}
                  >
                    Sign In
                  </button>
                  <div className="auth-divider" aria-hidden="true">
                    <span>or continue with</span>
                  </div>
                  <button
                    type="button"
                    className="secondary auth-provider-action"
                    disabled={busy}
                    onClick={onProviderSignIn}
                  >
                    Sign in with Google
                  </button>
                  <p className="auth-switch-copy">
                    Don&apos;t have an account?{" "}
                    <a
                      href="#"
                      className="auth-switch-link"
                      onClick={(event) => {
                        event.preventDefault();
                        if (!busy) {
                          onSwitchMode("signup");
                        }
                      }}
                    >
                      Sign Up
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="submit"
                    className="auth-primary-action"
                    disabled={busy}
                  >
                    Create Account
                  </button>
                  <p className="auth-switch-copy">
                    Already have an account?{" "}
                    <a
                      href="#"
                      className="auth-switch-link"
                      onClick={(event) => {
                        event.preventDefault();
                        if (!busy) {
                          onSwitchMode("signin");
                        }
                      }}
                    >
                      Sign In
                    </a>
                  </p>
                </>
              )}
            </form>
          )}
        </section>
      </div>
    </>
  );
}
