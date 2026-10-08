import React, { useEffect } from "react";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";
import { Button } from "../ui/Button.jsx";
import { Field, TextInput } from "../ui/Field.jsx";
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
  isSigningIn,
  isCreatingAccount,
  isSendingResetLink,
  isAuthPending,
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
                ? "Sign in to continue."
                : isResetRequest
                  ? "We'll email you a reset link."
                  : "Create an account to start extracting data from documents."}
            </p>
          </div>

          {accountVerificationPromptEmail ? (
            <div className="panel auth-verification-prompt" role="status">
              <h2>{localMail ? "Verify your account" : "Check your email to verify your account"}</h2>
              <p>
                {localMail ? (
                  <>
                    We saved a verification link for <b>{accountVerificationPromptEmail}</b> on this computer. Run{" "}
                    <code>document-extraction mail</code> to open it.
                  </>
                ) : (
                  <>
                    We sent an account verification link to <b>{accountVerificationPromptEmail}</b>. Open it to finish
                    setting up your account.
                  </>
                )}
              </p>
              <Button className="auth-primary-action" disabled={isAuthPending} onClick={() => onSwitchMode("signin")}>
                Back to sign in
              </Button>
            </div>
          ) : accountPasswordResetRequestedEmail ? (
            <div className="panel auth-verification-prompt" role="status">
              <h2>{localMail ? "Check your mail" : "Check your email"}</h2>
              <p>
                {localMail ? (
                  <>
                    If an account exists for <b>{accountPasswordResetRequestedEmail}</b>, we saved a reset link on this
                    computer. Run <code>document-extraction mail</code> to open it.
                  </>
                ) : (
                  <>
                    If an account exists for <b>{accountPasswordResetRequestedEmail}</b>, we sent a reset link.
                  </>
                )}
              </p>
              <Button className="auth-primary-action" disabled={isAuthPending} onClick={() => onSwitchMode("signin")}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form className="panel auth-panel" onSubmit={onSubmit} noValidate>
              <h2>{formTitle}</h2>
              {emailPasswordEnabled ? null : <p className="muted">Use your identity provider to continue.</p>}
              {emailPasswordEnabled ? (
                <>
                  <div className={isSignUp ? "row two-up auth-form-grid" : "row auth-form-grid"}>
                    {isSignUp ? (
                      <Field label="Name" error={fieldErrors.name}>
                        <TextInput
                          id={FIELD_IDS.name}
                          value={name}
                          autoComplete="name"
                          onChange={(event) => onNameChange(event.target.value)}
                          placeholder="Jane Doe"
                        />
                      </Field>
                    ) : null}
                    <Field label="Email" error={fieldErrors.email}>
                      <TextInput
                        id={FIELD_IDS.email}
                        type="email"
                        value={email}
                        autoComplete="email"
                        onChange={(event) => onEmailChange(event.target.value)}
                        onBlur={() => onFieldBlur("email")}
                        placeholder="jane@example.com"
                      />
                    </Field>
                    {isResetRequest ? null : (
                      <div className="auth-field">
                        <Field label="Password" error={fieldErrors.password}>
                          <TextInput
                            id={FIELD_IDS.password}
                            type="password"
                            value={password}
                            autoComplete={isSignUp ? "new-password" : "current-password"}
                            aria-describedby={showRequirements ? REQUIREMENTS_ID : undefined}
                            placeholder="••••••••"
                            onChange={(event) => {
                              onPasswordChange(event.target.value);

                              if (isSignUp) {
                                onPasswordTouched();
                              }
                            }}
                          />
                        </Field>
                        {isSignIn ? (
                          <SwitchModeButton
                            className="auth-forgot-password-link"
                            mode="reset-request"
                            disabled={isAuthPending}
                            onSwitchMode={onSwitchMode}
                          >
                            Forgot password?
                          </SwitchModeButton>
                        ) : null}
                      </div>
                    )}
                    {isSignUp ? (
                      <Field label="Confirm password" error={fieldErrors.confirmPassword}>
                        <TextInput
                          id={FIELD_IDS.confirmPassword}
                          type="password"
                          value={confirmPassword}
                          autoComplete="new-password"
                          placeholder="••••••••"
                          onChange={(event) => onConfirmPasswordChange(event.target.value)}
                          onBlur={() => onFieldBlur("confirmPassword")}
                        />
                      </Field>
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
                      <Button type="submit" className="auth-primary-action" pending={isSigningIn} pendingLabel="Signing in…">
                        Sign in
                      </Button>
                      {signupEnabled ? (
                        <p className="auth-switch-copy">
                          Don&apos;t have an account?{" "}
                          <SwitchModeButton mode="signup" disabled={isAuthPending} onSwitchMode={onSwitchMode}>
                            Sign up
                          </SwitchModeButton>
                        </p>
                      ) : (
                        <p className="muted">Account registration is closed. Contact the administrator for access.</p>
                      )}
                    </>
                  ) : isResetRequest ? (
                    <>
                      <Button type="submit" className="auth-primary-action" pending={isSendingResetLink} pendingLabel="Sending link…">
                        Send reset link
                      </Button>
                      <p className="auth-switch-copy">
                        Remember your password?{" "}
                        <SwitchModeButton mode="signin" disabled={isAuthPending} onSwitchMode={onSwitchMode}>
                          Sign in
                        </SwitchModeButton>
                      </p>
                    </>
                  ) : (
                    <>
                      <Button type="submit" className="auth-primary-action" pending={isCreatingAccount} pendingLabel="Creating account…">
                        Create account
                      </Button>
                      <p className="auth-switch-copy">
                        Already have an account?{" "}
                        <SwitchModeButton mode="signin" disabled={isAuthPending} onSwitchMode={onSwitchMode}>
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
                  <Button variant="secondary" className="auth-provider-action" disabled={isAuthPending} onClick={onProviderSignIn}>
                    Sign in with Google
                  </Button>
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

function SwitchModeButton({ className = "", mode, disabled, onSwitchMode, children }) {
  return (
    <Button variant="text" className={`auth-text-button ${className}`.trim()} disabled={disabled} onClick={() => onSwitchMode(mode)}>
      {children}
    </Button>
  );
}
