import { useEffect, useMemo, useRef, useState } from "react";
import { createNotifier, defaultToast } from "../../lib/notify";
import { useAsyncAction } from "../ui/useAsyncAction";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";

const PROFILE_SAVE_ERROR = "Profile could not be saved. Please try again.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [formError, setFormError] = useState("");
  const [focusRequest, setFocusRequest] = useState(null);
  const notify = useMemo(() => createNotifier(toast), [toast]);

  const [accountVerificationPromptEmail, setAccountVerificationPromptEmail] = useState("");

  const [accountPasswordResetRequestedEmail, setAccountPasswordResetRequestedEmail] = useState("");

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

  // Field errors sit under their inputs; the first invalid field takes focus.
  function rejectSubmit(errors) {
    setFieldErrors(errors);
    setFormError("");
    setFocusRequest({ field: Object.keys(errors)[0] });
  }

  function clearSubmitErrors() {
    setFieldErrors({});
    setFormError("");
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
      });

      if (result.error) {
        throw new Error(result.error.message || "Sign in failed");
      }

      setAuthPassword("");
      await refetchSession();
    } catch (error) {
      setFormError(getSignInErrorMessage(error.message, authOptions.mailDelivery));
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
      });

      if (result.error) {
        throw new Error(result.error.message || "Sign up failed");
      }

      const signedUpEmail = authEmail.trim();
      setAuthPassword("");
      setAuthConfirmPassword("");
      setAuthPasswordTouched(false);
      setSignUpSubmitAttempted(false);

      if (authOptions.requireEmailVerification) {
        setAccountVerificationPromptEmail(signedUpEmail);
      } else {
        await refetchSession();
      }
    } catch (error) {
      setFormError(getSignUpErrorMessage(error.message));
    }
  }

  async function signInWithGoogle() {
    setIsStartingGoogleSignIn(true);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.pathname === "/reset-password" ? window.location.origin : window.location.href,
      });

      if (result?.error) {
        throw new Error(result.error.message || "Google sign in failed");
      }
    } catch {
      setFormError("Google sign-in could not start. Try again.");
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

      setAccountPasswordResetRequestedEmail(requestedEmail);
    } catch {
      setFormError("Password reset request failed. Try again.");
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();

    if (!authOptions.emailPasswordEnabled || (authMode === "signup" && !authOptions.signupEnabled)) return;

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
    if (nextMode === "signup" && !authOptions.signupEnabled) return;
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthPasswordTouched(false);
    setSignUpSubmitAttempted(false);
    setAccountVerificationPromptEmail("");
    setAccountPasswordResetRequestedEmail("");
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
  }

  function updateField(field, setValue, value) {
    setValue(value);
    setFieldErrors((previous) => withFieldError(previous, field, ""));
  }

  async function signOut() {
    try {
      onSessionChanging?.();
      await authClient.signOut();
      onClearWorkspaceScopedTemplates();
      onClearWorkspaceScopedDocuments();
      onClearSessionWorkspaceData();
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
      formError,
      focusRequest,
      shouldShowPasswordRequirements: shouldShowAccountPasswordRequirements,
      unmetPasswordRequirements: unmetAccountPasswordRequirements,
      accountVerificationPromptEmail,
      accountPasswordResetRequestedEmail,
      onSubmit: submitAuthForm,
      onNameChange: (value) => updateField("name", setAuthName, value),
      onEmailChange: (nextEmail) => {
        updateField("email", setAuthEmail, nextEmail);
        setAccountVerificationPromptEmail("");
      },
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
      onSignOut: runSignOut,
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

function getSignInErrorMessage(message, mailDelivery) {
  const normalized = String(message || "").toLowerCase();

  if (normalized.includes("verify") || normalized.includes("verified") || normalized.includes("verification")) {
    return mailDelivery === "local"
      ? "Verify your account before signing in. Open the verification link in the server terminal or local mail capture."
      : "Verify your email before signing in. We sent you a new Account verification link.";
  }

  return "Sign in failed. Check your email and password and try again.";
}

function getSignUpErrorMessage(message) {
  const normalized = String(message || "").toLowerCase();

  if (normalized.includes("already") || normalized.includes("exists")) {
    return "An account already exists for this email. Sign in instead.";
  }

  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "Enter a valid email address and try again.";
  }

  return "Account creation failed. Please try again.";
}
