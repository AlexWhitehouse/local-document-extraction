import { useEffect, useMemo, useRef, useState } from "react";
import { isString } from "../../../../shared/json.ts";
import { createNotifier, defaultToast } from "../../lib/notify";
import { useAsyncAction } from "../ui/useAsyncAction";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";
import {
  describeSignInRedirectError,
  getAccessMessage,
  readSignInRedirectError,
  withoutSignInRedirectError,
} from "./signInAccess";

const PROFILE_SAVE_ERROR = "Couldn't save profile. Try again.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validation toasts share one id, so a newer problem replaces the last instead of stacking.
const AUTH_FORM_TOAST_ID = "auth-form";

const SIGN_IN_REDIRECT_TOAST_ID = "auth-sign-in-redirect";

// Must-act auth toasts (access refusals, verification and reset links) stay until dismissed. They
// share one id, so the newest replaces the last.
const MUST_ACT_TOAST = { persistent: true, id: "auth-must-act" };

// The auth screen's feedback is about getting a session, so it goes once one starts.
const AUTH_SCREEN_TOAST_IDS = [AUTH_FORM_TOAST_ID, SIGN_IN_REDIRECT_TOAST_ID, MUST_ACT_TOAST.id];

export const ACCOUNT_PASSWORD_REQUIREMENTS = [
  { label: "At least 8 characters", test: (password) => password.length >= 8 },
  { label: "One uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { label: "One number", test: (password) => /[0-9]/.test(password) },
  {
    label: "One special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export function useAuthProfileController({
  authOptions = DEFAULT_RUNTIME_CONFIGURATION.auth,
  authClient,
  toast = defaultToast,
  refetchSession,
  initialAuthMode = "signin",
  hasSession,
  sessionUserName,
  sessionUserEmail,
  onClearWorkspaceScopedTemplates,
  onClearWorkspaceScopedDocuments,
  onClearSessionWorkspaceData,
  onSessionChanging,
  confirmSignOut,
  continuationURL = "",
  showSignInRedirectError = false,
}) {
  const [authMode, setAuthMode] = useState(initialAuthMode);
  const [isStartingGoogleSignIn, setIsStartingGoogleSignIn] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authPasswordTouched, setAuthPasswordTouched] = useState(false);
  const [signUpSubmitAttempted, setSignUpSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(null);
  const notify = useMemo(() => createNotifier(toast), [toast]);

  // A delegated access page asks sign-in, verification and Google to return to it.
  const callback = continuationURL
    ? { callbackURL: withoutSignInRedirectError(new URL(continuationURL, window.location.origin).href) }
    : {};

  // A failed Google sign-in or verification link returns here with `?error=`.
  const [signInRedirectError] = useState(() =>
    showSignInRedirectError ? describeSignInRedirectError(readSignInRedirectError(window.location.search), authOptions) : null,
  );

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const profilePanelRef = useRef(null);

  const currentProfileName = (profileName.trim() || sessionUserName).trim();
  const currentProfileEmail = (profileEmail.trim() || sessionUserEmail).trim();
  const displayProfileName = currentProfileName || "Unnamed User";
  const displayProfileEmail = currentProfileEmail || "No email";
  const profileIsDirty = profileDraftName.trim() !== currentProfileName;
  const canSaveProfile = profileDraftName.trim().length > 0;

  const unmetAccountPasswordRequirements = ACCOUNT_PASSWORD_REQUIREMENTS.filter(
    (requirement) => !requirement.test(authPassword),
  );

  const shouldShowAccountPasswordRequirements = authMode === "signup" && (authPasswordTouched || signUpSubmitAttempted);

  useEffect(() => {
    if (!hasSession) {
      setIsProfileMenuOpen(false);

      return;
    }

    setProfileName(sessionUserName);
    setProfileEmail(sessionUserEmail);
  }, [hasSession, sessionUserEmail, sessionUserName]);

  useEffect(() => {
    if (isProfileMenuOpen) {
      return;
    }

    setProfileDraftName(currentProfileName);
  }, [currentProfileName, isProfileMenuOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  // The error leaves the address once shown, so a reload doesn't repeat it.
  useEffect(() => {
    if (!signInRedirectError) return;

    window.history.replaceState(window.history.state, "", withoutSignInRedirectError(window.location.href));
    notify("auth.signIn", "failure", { ...signInRedirectError, id: SIGN_IN_REDIRECT_TOAST_ID });
  }, [notify, signInRedirectError]);

  // A session that ends without signing out here (access removed, expired, or signed out in
  // another tab) clears the same state as signing out.
  const hadSessionRef = useRef(hasSession);
  const clearEndedSessionRef = useRef(null);

  clearEndedSessionRef.current = () => {
    onSessionChanging?.();
    clearSessionState();
  };

  useEffect(() => {
    if (hadSessionRef.current && !hasSession) clearEndedSessionRef.current();

    if (!hadSessionRef.current && hasSession) {
      for (const id of AUTH_SCREEN_TOAST_IDS) notify.dismiss(id);
    }

    hadSessionRef.current = hasSession;
  }, [hasSession, notify]);

  // Invalid fields are outlined and the first one takes focus; its message is a toast.
  function rejectSubmit(errors) {
    const [field, message] = Object.entries(errors)[0];

    setFieldErrors(errors);
    setFocusRequest({ field });
    notifyFieldError(message);
  }

  function notifyFieldError(message) {
    notify("auth.form", "failure", { message, id: AUTH_FORM_TOAST_ID });
  }

  function clearSubmitErrors() {
    setFieldErrors({});
  }

  const [isSigningIn, runSignIn] = useAsyncAction(signIn);
  const [isCreatingAccount, runSignUp] = useAsyncAction(signUp);
  const [isSendingResetLink, runRequestAccountPasswordReset] = useAsyncAction(requestAccountPasswordReset);
  const [isSigningOut, runSignOut] = useAsyncAction(signOut);

  async function signIn() {
    const errors = compactErrors({
      email: getEmailError(authEmail),
      password: authPassword.trim() ? "" : "Enter your password.",
    });

    if (Object.keys(errors).length > 0) {
      rejectSubmit(errors);

      return;
    }

    clearSubmitErrors();

    try {
      const result = await authClient.signIn.email({
        email: authEmail.trim(),
        password: authPassword,
        ...callback,
      });

      if (result.error) {
        throw authFailure(result.error, "Sign in failed");
      }

      setAuthPassword("");
      await refetchSession();
    } catch (error) {
      notify("auth.signIn", "failure", getSignInFailure(error, authOptions.mailDelivery));
    }
  }

  async function signUp() {
    setSignUpSubmitAttempted(true);

    const errors = compactErrors({
      name: authName.trim() ? "" : "Enter your name.",
      email: getEmailError(authEmail),
      password: getSignUpPasswordError(authPassword, unmetAccountPasswordRequirements),
      confirmPassword: getConfirmPasswordError(authPassword, authConfirmPassword),
    });

    if (Object.keys(errors).length > 0) {
      rejectSubmit(errors);

      return;
    }

    clearSubmitErrors();

    try {
      const result = await authClient.signUp.email({
        name: authName.trim(),
        email: authEmail.trim(),
        password: authPassword,
        ...callback,
      });

      if (result.error) {
        throw authFailure(result.error, "Sign up failed");
      }

      const signedUpEmail = authEmail.trim();
      setAuthPassword("");
      setAuthConfirmPassword("");
      setAuthPasswordTouched(false);
      setSignUpSubmitAttempted(false);

      if (authOptions.requireEmailVerification) {
        notify("auth.signUp", "success", {
          message: getVerificationSentMessage(signedUpEmail, authOptions.mailDelivery),
          ...MUST_ACT_TOAST,
        });
        switchAuthMode("signin");
      } else {
        await refetchSession();
      }
    } catch (error) {
      notify("auth.signUp", "failure", getSignUpFailure(error));
    }
  }

  async function signInWithGoogle() {
    setIsStartingGoogleSignIn(true);

    // A refused or failed Google sign-in returns to the same page with `?error=`.
    const returnURL =
      callback.callbackURL ||
      (window.location.pathname === "/reset-password"
        ? window.location.origin
        : withoutSignInRedirectError(window.location.href));

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnURL,
        errorCallbackURL: returnURL,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Google sign in failed");
      }
    } catch {
      notify("auth.googleSignIn", "failure", { retry: () => void signInWithGoogle() });
      setIsStartingGoogleSignIn(false);
    }
  }

  async function requestAccountPasswordReset() {
    const emailError = getEmailError(authEmail);

    if (emailError) {
      rejectSubmit({ email: emailError });

      return;
    }

    const requestedEmail = authEmail.trim();
    clearSubmitErrors();

    try {
      const result = await authClient.requestPasswordReset({
        email: requestedEmail,
        redirectTo: "/reset-password",
      });

      if (result?.error) {
        throw new Error(result.error.message || "Account password reset request failed");
      }

      notify("auth.requestPasswordReset", "success", {
        message: getResetLinkSentMessage(requestedEmail, authOptions.mailDelivery),
        ...MUST_ACT_TOAST,
      });
      switchAuthMode("signin");
    } catch {
      notify("auth.requestPasswordReset", "failure", { retry: () => void runRequestAccountPasswordReset() });
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();

    if (!authOptions.emailPasswordEnabled) return;

    if (authMode === "reset-request") {
      await runRequestAccountPasswordReset();

      return;
    }

    if (authMode === "signin") {
      await runSignIn();

      return;
    }

    await runSignUp();
  }

  function switchAuthMode(nextMode) {
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthPasswordTouched(false);
    setSignUpSubmitAttempted(false);
    clearSubmitErrors();
  }

  // Blur checks only fields the user has filled in; empty required fields wait for submit.
  function checkFieldOnBlur(field) {
    const value = { name: authName, email: authEmail, confirmPassword: authConfirmPassword }[field];

    if (!value?.trim()) return;

    const error =
      field === "email"
        ? getEmailError(authEmail)
        : field === "confirmPassword"
          ? getConfirmPasswordError(authPassword, authConfirmPassword)
          : "";

    setFieldErrors((previous) => withFieldError(previous, field, error));

    if (error) notifyFieldError(error);
  }

  function updateField(field, setValue, value) {
    setValue(value);
    setFieldErrors((previous) => withFieldError(previous, field, ""));
  }

  function clearSessionState() {
    onClearWorkspaceScopedTemplates();
    onClearWorkspaceScopedDocuments();
    onClearSessionWorkspaceData();
  }

  async function signOut() {
    try {
      onSessionChanging?.();
      await authClient.signOut();
      clearSessionState();
      // Already cleared, so the session ending next isn't treated as ending elsewhere.
      hadSessionRef.current = false;
      await refetchSession();
    } catch (error) {
      // A failed sign out keeps the current session in place.
      notify("auth.signOut", "failure", { error });
    }
  }

  async function saveProfile() {
    const name = profileDraftName.trim();

    if (!name) {
      return;
    }

    setIsSavingProfile(true);
    setProfileSaveError("");

    try {
      const result = await authClient.updateUser({ name });

      if (result?.error) {
        throw new Error(result.error.message || "Profile update failed");
      }

      const nextName = String(result?.data?.name || result?.data?.user?.name || name);
      setProfileName(nextName);
      setAuthName(nextName);
      await refetchSession();
      setIsProfileMenuOpen(false);
      notify("profile.update", "success");
    } catch {
      // A failed save keeps the menu open with the draft name for another attempt.
      setProfileSaveError(PROFILE_SAVE_ERROR);
    } finally {
      setIsSavingProfile(false);
    }
  }

  const isAuthPending = isSigningIn || isCreatingAccount || isSendingResetLink || isStartingGoogleSignIn;

  return {
    authScreen: {
      authOptions,
      mode: authMode,
      name: authName,
      email: authEmail,
      password: authPassword,
      confirmPassword: authConfirmPassword,
      isSigningIn,
      isCreatingAccount,
      isSendingResetLink,
      isStartingGoogleSignIn,
      isAuthPending,
      fieldErrors,
      focusRequest,
      shouldShowPasswordRequirements: shouldShowAccountPasswordRequirements,
      unmetPasswordRequirements: unmetAccountPasswordRequirements,
      onSubmit: submitAuthForm,
      onNameChange: (value) => updateField("name", setAuthName, value),
      onEmailChange: (nextEmail) => updateField("email", setAuthEmail, nextEmail),
      onPasswordChange: (value) => {
        updateField("password", setAuthPassword, value);

        // A mismatch clears as soon as the passwords agree again.
        if (authConfirmPassword && value === authConfirmPassword) {
          setFieldErrors((previous) => withFieldError(previous, "confirmPassword", ""));
        }
      },
      onConfirmPasswordChange: (value) => updateField("confirmPassword", setAuthConfirmPassword, value),
      onPasswordTouched: () => setAuthPasswordTouched(true),
      onFieldBlur: checkFieldOnBlur,
      onProviderSignIn: signInWithGoogle,
      onSwitchMode: switchAuthMode,
    },
    profileMenu: {
      panelRef: profilePanelRef,
      displayName: displayProfileName,
      displayEmail: displayProfileEmail,
      draftName: profileDraftName,
      isOpen: isProfileMenuOpen,
      isDirty: profileIsDirty,
      isSavingProfile,
      canSaveProfile,
      saveError: profileSaveError,
      isSigningOut,
      onToggle: () => setIsProfileMenuOpen((currentOpen) => !currentOpen),
      onDraftNameChange: (value) => {
        setProfileSaveError("");
        setProfileDraftName(value);
      },
      onSaveProfile: saveProfile,
      // Unsaved edits are confirmed before the pending sign-out starts.
      onSignOut: async () => {
        if (!confirmSignOut || (await confirmSignOut())) await runSignOut();
      },
    },
  };
}

function compactErrors(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
}

function withFieldError(errors, field, message) {
  if (!message && !(field in errors)) return errors;

  const next = { ...errors };

  if (message) next[field] = message;
  else delete next[field];

  return next;
}

function getEmailError(email) {
  const trimmed = email.trim();

  if (!trimmed) return "Enter your email address.";

  return EMAIL_PATTERN.test(trimmed) ? "" : "Enter a valid email address.";
}

function getSignUpPasswordError(password, unmetRequirements) {
  if (!password.trim()) return "Enter a password.";

  return unmetRequirements.length > 0 ? "Password doesn't meet all the requirements below." : "";
}

function getConfirmPasswordError(password, confirmPassword) {
  if (!confirmPassword.trim()) return "Confirm your password.";

  return password !== confirmPassword ? "Passwords do not match." : "";
}

function getVerificationSentMessage(email, mailDelivery) {
  return mailDelivery === "local"
    ? `Account created. Run \`document-extraction mail\` to open the verification link for ${email}.`
    : `Account created. Open the verification link we sent to ${email}.`;
}

function getResetLinkSentMessage(email, mailDelivery) {
  return mailDelivery === "local"
    ? `If an account exists for ${email}, run \`document-extraction mail\` to open its reset link.`
    : `If an account exists for ${email}, we sent it a reset link.`;
}

// Keeps Better Auth's error code, so invite-only refusals map on the code rather than the wording.
function authFailure(error, fallback) {
  return Object.assign(new Error(error.message || fallback), { code: isString(error.code) ? error.code : "" });
}

function getSignInFailure(error, mailDelivery) {
  const accessMessage = getAccessMessage(error.code);

  if (accessMessage) return { message: accessMessage, ...MUST_ACT_TOAST };

  const normalized = String(error.message || "").toLowerCase();

  if (normalized.includes("verify") || normalized.includes("verified") || normalized.includes("verification")) {
    return {
      message:
        mailDelivery === "local"
          ? "Verify your account before signing in. Run `document-extraction mail` to open the link."
          : "Verify your email before signing in. We sent you a new account verification link.",
      ...MUST_ACT_TOAST,
    };
  }

  return { message: "Sign in failed. Check your email and password and try again." };
}

function getSignUpFailure(error) {
  const accessMessage = getAccessMessage(error.code);

  if (accessMessage) return { message: accessMessage, ...MUST_ACT_TOAST };

  const normalized = String(error.message || "").toLowerCase();

  if (normalized.includes("already") || normalized.includes("exists")) {
    return { message: "An account already exists for this email. Sign in instead." };
  }

  if (normalized.includes("invalid") && normalized.includes("email")) {
    return { message: "Enter a valid email address and try again." };
  }

  return { message: "Couldn't create account. Try again." };
}
