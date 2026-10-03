export function userIdOf(user) {
  return String(user?.id || "").trim();
}

export function safeText(value) {
  const text = String(value || "").trim();
  return text || "—";
}

export function displayName(user) {
  return String(user?.name || "").trim() || safeText(user?.email);
}

export function isEmailVerified(user) {
  return Boolean(user.emailVerified ?? user.email_verified);
}

export function isApplicationAdmin(user) {
  return String(user.role || "user").trim() === "admin";
}

// Short markers for the account list; an active, verified regular user carries none.
export function accountFlags(user) {
  return [
    isApplicationAdmin(user) ? { label: "Admin", tone: "busy" } : null,
    user.banned ? { label: "Banned", tone: "bad" } : null,
    isEmailVerified(user) ? null : { label: "Unverified", tone: "warn" },
  ].filter(Boolean);
}
