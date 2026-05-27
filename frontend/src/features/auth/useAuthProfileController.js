import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const ACCOUNT_PASSWORD_REQUIREMENTS = [
  { label: "At least 8 characters", test: (password) => password.length >= 8 },
  { label: "One uppercase letter", test: (password) => /[A-Z]/.test(password) },
  { label: "One number", test: (password) => /[0-9]/.test(password) },
  {
    label: "One special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export function useAuthProfileController({
  authClient,
  refetchSession,
  request,
  addLog,
  initialAuthMode = "signin",
  hasSession,
  sessionUserName,
  sessionUserEmail,
  busy,
  setBusy,
  onClearWorkspaceScopedTemplates,
  onClearWorkspaceScopedDocuments,
  onClearSessionWorkspaceData,
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

    function handlePointerDown(event) {
      if (profilePanelRef.current?.contains(event.target)) {
        return;
      }
      setIsProfileMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  async function signIn() {
    if (!authEmail.trim() || !authPassword.trim()) {
      addLog("Sign in failed: email and password are required");
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
      addLog(`Signed in as ${authEmail.trim()}`);
    } catch (error) {
      addLog(`Sign in failed: ${error.message}`);
      toast.error(getSignInErrorToastMessage(error.message));
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
      addLog(`Sign up failed: ${fieldList} required`);
      toast.error(`${displayFieldList} ${requiredVerb} required.`);
      return;
    }
    if (unmetAccountPasswordRequirements.length > 0) {
      addLog("Sign up failed: password does not meet complexity requirements");
      toast.error("Password must meet all complexity requirements.");
      return;
    }
    if (hasSignUpPasswordMismatch) {
      addLog("Sign up failed: passwords do not match");
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
      setAccountVerificationPromptEmail(signedUpEmail);
      addLog(`Account verification required for ${signedUpEmail}`);
    } catch (error) {
      addLog(`Sign up failed: ${error.message}`);
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
    } catch (error) {
      addLog(`Google sign in failed: ${error.message}`);
      toast.error("Google sign-in could not start. Please try again.");
      setBusy(false);
    }
  }

  async function requestAccountPasswordReset() {
    if (!authEmail.trim()) {
      addLog("Account password reset request failed: email is required");
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
      addLog(`Account password reset requested for ${requestedEmail}`);
    } catch (error) {
      addLog(`Account password reset request failed: ${error.message}`);
      toast.error("Password reset request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAuthForm(event) {
    event.preventDefault();
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
      await authClient.signOut();
      onClearWorkspaceScopedTemplates();
      onClearWorkspaceScopedDocuments();
      onClearSessionWorkspaceData();
      await refetchSession();
      addLog("Signed out");
    } catch (error) {
      addLog(`Sign out failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile() {
    if (!hasSession) {
      return;
    }

    try {
      const data = await request("/profile", { method: "GET" }, true, false);
      const nextName = String(data?.name || "").trim();
      const nextEmail = String(data?.email || "").trim();
      setProfileName(nextName);
      setProfileEmail(nextEmail);
      setAuthName(nextName);
      setAuthEmail(nextEmail);
    } catch (error) {
      addLog(`Load profile failed: ${error.message}`);
    }
  }

  async function saveProfile() {
    const name = profileDraftName.trim();
    const email = currentProfileEmail.toLowerCase();

    if (!name) {
      addLog("Profile update failed: name is required");
      return;
    }

    setIsSavingProfile(true);
    try {
      const data = await request(
        "/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        },
        true,
        false,
      );
      const nextName = String(data?.name || name);
      const nextEmail = String(data?.email || email);
      setProfileName(nextName);
      setProfileEmail(nextEmail);
      setAuthName(nextName);
      setAuthEmail(nextEmail);
      await refetchSession();
      addLog("Profile updated");
      setIsProfileMenuOpen(false);
    } catch (error) {
      addLog(`Profile update failed: ${error.message}`);
    } finally {
      setIsSavingProfile(false);
    }
  }

  useEffect(() => {
    if (!hasSession) {
      return;
    }

    void loadProfile();
  }, [hasSession]);

  return {
    authScreen: {
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

function getSignInErrorToastMessage(message) {
  const normalized = String(message || "").toLowerCase();
  if (
    normalized.includes("verify") ||
    normalized.includes("verified") ||
    normalized.includes("verification")
  ) {
    return "Verify your email before signing in. We sent you a new Account verification link.";
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
