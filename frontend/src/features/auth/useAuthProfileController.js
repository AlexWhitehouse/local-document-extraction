import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_RUNTIME_CONFIGURATION } from "../../lib/runtimeConfiguration";

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
  refetchSession,
  initialAuthMode = "signin",
  hasSession,
  sessionUserName,
  sessionUserEmail,
  busy,
  setBusy,
  onClearWorkspaceScopedTemplates,
  onClearWorkspaceScopedDocuments,
  onClearSessionWorkspaceData,
  onSessionChanging,
}) {
  const [authMode, setAuthMode] = useState(initialAuthMode);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authPasswordTouched, setAuthPasswordTouched] = useState(false);
  const [signUpSubmitAttempted, setSignUpSubmitAttempted] = useState(false);
  const [accountVerificationPromptEmail, setAccountVerificationPromptEmail] =
    useState("");
  const [accountPasswordResetRequestedEmail, setAccountPasswordResetRequestedEmail] =
    useState("");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const profilePanelRef = useRef(null);

  const currentProfileName = (profileName.trim() || sessionUserName).trim();
  const currentProfileEmail = (profileEmail.trim() || sessionUserEmail).trim();
  const displayProfileName = currentProfileName || "Unnamed User";
  const displayProfileEmail = currentProfileEmail || "No email";
  const profileIsDirty = profileDraftName.trim() !== currentProfileName;
  const unmetAccountPasswordRequirements = ACCOUNT_PASSWORD_REQUIREMENTS.filter(
    (requirement) => !requirement.test(authPassword),
  );
  const shouldShowAccountPasswordRequirements =
    authMode === "signup" && (authPasswordTouched || signUpSubmitAttempted);
  const hasSignUpPasswordMismatch =
    authMode === "signup" &&
    authConfirmPassword.length > 0 &&
    authPassword !== authConfirmPassword;

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

  async function signIn() {
    if (!authEmail.trim() || !authPassword.trim()) {
      toast.error("Email and password are required.");
      return;
    }

    setBusy(true);
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
      toast.error(getSignInErrorToastMessage(error.message, authOptions.mailDelivery));
    } finally {
      setBusy(false);
    }
  }

  async function signUp() {
    setSignUpSubmitAttempted(true);
    const missingSignUpFields = [];
    if (!authName.trim()) missingSignUpFields.push("Name");
    if (!authEmail.trim()) missingSignUpFields.push("email");
    if (!authPassword.trim()) missingSignUpFields.push("password");
    if (!authConfirmPassword.trim()) {
      missingSignUpFields.push("confirm password");
    }
    if (missingSignUpFields.length > 0) {
      const lastField = missingSignUpFields[missingSignUpFields.length - 1];
      const leadingFields = missingSignUpFields.slice(0, -1);
      const fieldList =
        leadingFields.length === 0
          ? lastField
          : leadingFields.length === 1
            ? `${leadingFields[0]} and ${lastField}`
            : `${leadingFields.join(", ")}, and ${lastField}`;
      const requiredVerb = missingSignUpFields.length === 1 ? "is" : "are";
      const displayFieldList = fieldList[0].toUpperCase() + fieldList.slice(1);
      toast.error(`${displayFieldList} ${requiredVerb} required.`);
      return;
    }
    if (unmetAccountPasswordRequirements.length > 0) {
      toast.error("Password must meet all complexity requirements.");
      return;
    }
    if (hasSignUpPasswordMismatch) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
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
      toast.error(getSignUpErrorToastMessage(error.message));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (result?.error) {
        throw new Error(result.error.message || "Google sign in failed");
      }
    } catch {
      toast.error("Google sign-in could not start. Please try again.");
      setBusy(false);
    }
  }

  async function requestAccountPasswordReset() {
    if (!authEmail.trim()) {
      toast.error("Email is required.");
      return;
    }

    const requestedEmail = authEmail.trim();
    setBusy(true);
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
      toast.error("Password reset request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    if (!authOptions.emailPasswordEnabled || (authMode === "signup" && !authOptions.signupEnabled)) return;
    if (authMode === "reset-request") {
      await requestAccountPasswordReset();
      return;
    }
    if (authMode === "signin") {
      await signIn();
      return;
    }
    await signUp();
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
  }

  async function signOut() {
    setBusy(true);
    try {
      onSessionChanging?.();
      await authClient.signOut();
      onClearWorkspaceScopedTemplates();
      onClearWorkspaceScopedDocuments();
      onClearSessionWorkspaceData();
      await refetchSession();
    } catch {
      // A failed sign out keeps the current session in place.
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    const name = profileDraftName.trim();

    if (!name) {
      return;
    }

    setIsSavingProfile(true);
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
    } catch {
      // A failed save keeps the menu open with the draft name for another attempt.
    } finally {
      setIsSavingProfile(false);
    }
  }

  return {
    authScreen: {
      authOptions,
      mode: authMode,
      name: authName,
      email: authEmail,
      password: authPassword,
      confirmPassword: authConfirmPassword,
      busy,
      hasPasswordMismatch: hasSignUpPasswordMismatch,
      shouldShowPasswordRequirements: shouldShowAccountPasswordRequirements,
      unmetPasswordRequirements: unmetAccountPasswordRequirements,
      accountVerificationPromptEmail,
      accountPasswordResetRequestedEmail,
      onSubmit: submitAuthForm,
      onNameChange: setAuthName,
      onEmailChange: (nextEmail) => {
        setAuthEmail(nextEmail);
        setAccountVerificationPromptEmail("");
      },
      onPasswordChange: setAuthPassword,
      onConfirmPasswordChange: setAuthConfirmPassword,
      onPasswordTouched: () => setAuthPasswordTouched(true),
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
      busy,
      onToggle: () => setIsProfileMenuOpen((currentOpen) => !currentOpen),
      onDraftNameChange: setProfileDraftName,
      onSaveProfile: saveProfile,
      onSignOut: signOut,
    },
  };
}

function getSignInErrorToastMessage(message, mailDelivery) {
  const normalized = String(message || "").toLowerCase();
  if (
    normalized.includes("verify") ||
    normalized.includes("verified") ||
    normalized.includes("verification")
  ) {
    return mailDelivery === "local"
      ? "Verify your account before signing in. Open the verification link in the server terminal or local mail capture."
      : "Verify your email before signing in. We sent you a new Account verification link.";
  }
  return "Sign in failed. Check your email and password and try again.";
}

function getSignUpErrorToastMessage(message) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("already") || normalized.includes("exists")) {
    return "An account already exists for this email. Sign in instead.";
  }
  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "Enter a valid email address and try again.";
  }
  return "Account creation failed. Please try again.";
}
