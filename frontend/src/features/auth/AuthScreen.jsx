import React, { useEffect } from "react";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";
import "./AuthScreen.css";

const FIELD_IDS = {
  name: "auth-name",
  email: "auth-email",
  password: "auth-password",
  confirmPassword: "auth-confirm-password",
};

const REQUIREMENTS_ID = "auth-password-requirements";

export function AuthScreen({
  authOptions = DEFAULT_RUNTIME_CONFIGURATION.auth,
  mode,
  name,
  email,
  password,
  confirmPassword,
  busy,
  fieldErrors = {},
  formError,
  focusRequest,
  shouldShowPasswordRequirements,
  unmetPasswordRequirements,
  accountVerificationPromptEmail,
  accountPasswordResetRequestedEmail,
  onSubmit,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onPasswordTouched,
  onFieldBlur,
  onProviderSignIn,
  onSwitchMode,
}) {
  const { emailPasswordEnabled, googleEnabled, signupEnabled, mailDelivery } = authOptions;
  const isSignUp = emailPasswordEnabled && signupEnabled && mode === "signup";
  const isResetRequest = emailPasswordEnabled && mode === "reset-request";
  const isSignIn = !isSignUp && !isResetRequest;
  const localMail = mailDelivery === "local";
  const formTitle = isResetRequest ? "Reset password" : isSignIn ? "Sign in" : "Create account";
  const showRequirements = shouldShowPasswordRequirements && unmetPasswordRequirements.length > 0;

  const passwordDescribedBy =
    [fieldErrors.password ? `${FIELD_IDS.password}-error` : "", showRequirements ? REQUIREMENTS_ID : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  // Focus the first invalid field after a rejected submit (the controller sets focusRequest).
  useEffect(() => {
    if (focusRequest) document.getElementById(FIELD_IDS[focusRequest.field])?.focus();
  }, [focusRequest]);

  const formAlert = formError ? (
    <p role="alert" className="auth-form-error">
      {formError}
    </p>
  ) : null;

  return (
    <>
      <div className="auth-shell">
        <section className="auth-card">
          <div className="auth-header">
            <p className="eyebrow">Document Extraction</p>
            <h1>Studio</h1>
            <p>
              {isSignIn
                ? "Welcome back. Sign in to continue working in your workspace."
                : isResetRequest
                  ? "Enter your account email and we will send a password reset link."
                  : "Create your account to start extracting structured data from documents."}
            </p>
          </div>

          <div className="status-strip auth-status-strip">
            <span className="status-chip good">Secure auth</span>
            <span className="status-chip">Workspace-ready</span>
          </div>

          {accountVerificationPromptEmail ? (
            <div className="panel auth-verification-prompt" role="status">
              <h2>{localMail ? "Open your local verification link." : "Check your email to verify your account."}</h2>
              <p>
                {localMail ? (
                  <>
                    A verification link for <b>{accountVerificationPromptEmail}</b> was saved on the computer running
                    this app. Open the link printed in the server terminal, or run <code>document-extraction mail</code>{" "}
                    after an installer setup. Manual installs save messages under{" "}
                    <code>DOCUMENT_EXTRACTION_STATE_DIR/mail</code> (default <code>.local/mail</code>).
                  </>
                ) : (
                  <>
                    We sent an Account verification link to <b>{accountVerificationPromptEmail}</b>. Open it to finish
                    setting up your account.
                  </>
                )}
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
          ) : accountPasswordResetRequestedEmail ? (
            <div className="panel auth-verification-prompt" role="status">
              <h2>{localMail ? "Check local mail" : "Check your email"}</h2>
              <p>
                If an account exists for <b>{accountPasswordResetRequestedEmail}</b>, a reset link has{" "}
                {localMail
                  ? "been saved in the server terminal and local mail capture. Run document-extraction mail after an installer setup, or inspect your state directory's mail folder."
                  : "been sent."}
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
            <form className="panel auth-panel" onSubmit={onSubmit} noValidate>
              <h2>{formTitle}</h2>
              <p className="muted">
                {!emailPasswordEnabled
                  ? "Use your identity provider to continue."
                  : isResetRequest
                    ? "If an account exists for that email, a reset link will be sent."
                    : "Sign in first, then create or select a workspace."}
              </p>
              {emailPasswordEnabled ? (
                <>
                  <div className={isSignUp ? "row two-up auth-form-grid" : "row auth-form-grid"}>
                    {isSignUp ? (
                      <div className="auth-field">
                        <label htmlFor={FIELD_IDS.name} className="auth-field-label">
                          Name
                        </label>
                        <input
                          id={FIELD_IDS.name}
                          value={name}
                          autoComplete="name"
                          aria-invalid={Boolean(fieldErrors.name) || undefined}
                          aria-describedby={fieldErrors.name ? `${FIELD_IDS.name}-error` : undefined}
                          className={fieldErrors.name ? "auth-input-error" : ""}
                          onChange={(event) => onNameChange(event.target.value)}
                          placeholder="Jane Doe"
                        />
                        <FieldError id={`${FIELD_IDS.name}-error`} message={fieldErrors.name} />
                      </div>
                    ) : null}
                    <div className="auth-field">
                      <label htmlFor={FIELD_IDS.email} className="auth-field-label">
                        Email
                      </label>
                      <input
                        id={FIELD_IDS.email}
                        type="email"
                        value={email}
                        autoComplete="email"
                        aria-invalid={Boolean(fieldErrors.email) || undefined}
                        aria-describedby={fieldErrors.email ? `${FIELD_IDS.email}-error` : undefined}
                        className={fieldErrors.email ? "auth-input-error" : ""}
                        onChange={(event) => onEmailChange(event.target.value)}
                        onBlur={() => onFieldBlur("email")}
                        placeholder="jane@example.com"
                      />
                      <FieldError id={`${FIELD_IDS.email}-error`} message={fieldErrors.email} />
                    </div>
                    {isResetRequest ? null : (
                      <div className="auth-field">
                        <div className="auth-password-label-row">
                          <label htmlFor={FIELD_IDS.password} className="auth-field-label">
                            Password
                          </label>
                          {isSignIn ? (
                            <SwitchModeButton
                              className="auth-forgot-password-link"
                              mode="reset-request"
                              busy={busy}
                              onSwitchMode={onSwitchMode}
                            >
                              Forgot password?
                            </SwitchModeButton>
                          ) : null}
                        </div>
                        <input
                          id={FIELD_IDS.password}
                          type="password"
                          value={password}
                          autoComplete={isSignUp ? "new-password" : "current-password"}
                          aria-invalid={Boolean(fieldErrors.password) || undefined}
                          aria-describedby={passwordDescribedBy}
                          className={fieldErrors.password ? "auth-input-error" : ""}
                          onChange={(event) => {
                            onPasswordChange(event.target.value);

                            if (isSignUp) {
                              onPasswordTouched();
                            }
                          }}
                          placeholder="************"
                        />
                        <FieldError id={`${FIELD_IDS.password}-error`} message={fieldErrors.password} />
                      </div>
                    )}
                    {isSignUp ? (
                      <div className="auth-field">
                        <label htmlFor={FIELD_IDS.confirmPassword} className="auth-field-label">
                          Confirm Password
                        </label>
                        <input
                          id={FIELD_IDS.confirmPassword}
                          type="password"
                          value={confirmPassword}
                          autoComplete="new-password"
                          aria-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
                          aria-describedby={
                            fieldErrors.confirmPassword ? `${FIELD_IDS.confirmPassword}-error` : undefined
                          }
                          className={fieldErrors.confirmPassword ? "auth-input-error" : ""}
                          onChange={(event) => onConfirmPasswordChange(event.target.value)}
                          onBlur={() => onFieldBlur("confirmPassword")}
                          placeholder="Repeat password"
                        />
                        <FieldError
                          id={`${FIELD_IDS.confirmPassword}-error`}
                          message={fieldErrors.confirmPassword}
                        />
                      </div>
                    ) : null}
                  </div>
                  {shouldShowPasswordRequirements && unmetPasswordRequirements.length > 0 ? (
                    <ul id={REQUIREMENTS_ID} className="auth-password-requirements">
                      {unmetPasswordRequirements.map((requirement) => (
                        <li key={requirement.label}>{requirement.label}</li>
                      ))}
                    </ul>
                  ) : null}
                  {formAlert}
                  {isSignIn ? (
                    <>
                      <button type="submit" className="auth-primary-action" disabled={busy}>
                        {busy ? "Signing in…" : "Sign in"}
                      </button>
                      {signupEnabled ? (
                        <p className="auth-switch-copy">
                          Don&apos;t have an account?{" "}
                          <SwitchModeButton mode="signup" busy={busy} onSwitchMode={onSwitchMode}>
                            Sign up
                          </SwitchModeButton>
                        </p>
                      ) : (
                        <p className="muted">Account registration is closed. Contact the administrator for access.</p>
                      )}
                    </>
                  ) : isResetRequest ? (
                    <>
                      <button type="submit" className="auth-primary-action" disabled={busy}>
                        {busy ? "Sending link…" : "Send reset link"}
                      </button>
                      <p className="auth-switch-copy">
                        Remember your password?{" "}
                        <SwitchModeButton mode="signin" busy={busy} onSwitchMode={onSwitchMode}>
                          Sign in
                        </SwitchModeButton>
                      </p>
                    </>
                  ) : (
                    <>
                      <button type="submit" className="auth-primary-action" disabled={busy}>
                        {busy ? "Creating account…" : "Create Account"}
                      </button>
                      <p className="auth-switch-copy">
                        Already have an account?{" "}
                        <SwitchModeButton mode="signin" busy={busy} onSwitchMode={onSwitchMode}>
                          Sign in
                        </SwitchModeButton>
                      </p>
                    </>
                  )}
                </>
              ) : null}
              {googleEnabled && isSignIn ? (
                <>
                  {emailPasswordEnabled ? (
                    <div className="auth-divider" aria-hidden="true">
                      <span>or continue with</span>
                    </div>
                  ) : (
                    formAlert
                  )}
                  <button
                    type="button"
                    className="secondary auth-provider-action"
                    disabled={busy}
                    onClick={onProviderSignIn}
                  >
                    Sign in with Google
                  </button>
                  {!emailPasswordEnabled && !signupEnabled ? (
                    <p className="muted">Account registration is closed. Contact the administrator for access.</p>
                  ) : null}
                </>
              ) : null}
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function FieldError({ id, message }) {
  return message ? (
    <p id={id} className="auth-field-error">
      {message}
    </p>
  ) : null;
}

function SwitchModeButton({ className = "", mode, busy, onSwitchMode, children }) {
  return (
    <button
      type="button"
      className={`auth-text-button ${className}`.trim()}
      disabled={busy}
      onClick={() => onSwitchMode(mode)}
    >
      {children}
    </button>
  );
}
