import type { Database } from "bun:sqlite";

/** Installation access is independent of the account-management admin role. */
export function createLocalAccountAccess(database: Database, {
  signupEnabled = true,
  adminEmails = [],
}: { signupEnabled?: boolean; adminEmails?: string[] } = {}) {
  const configuredEmails = new Set(adminEmails.map((email) => email.trim().toLowerCase()));

  const hasTable = (name: string) => Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

  const account = (userId: string) => database.query<{ email: string; role: string | null }, [string]>("SELECT email, role FROM user WHERE id = ?").get(userId);

  const isInstallationAdmin = (userId: string) => {
    const user = account(userId);

    return Boolean(user && (user.role === "admin" || configuredEmails.has(user.email.trim().toLowerCase())));
  };

  const hasPendingInvitation = (email: string) => hasTable("workspace_invitations") && Boolean(database.query(
    "SELECT 1 FROM workspace_invitations WHERE email = ? AND status = 'pending' AND expires_at > ? LIMIT 1",
  ).get(email.trim().toLowerCase(), new Date().toISOString()));

  return {
    canRegister: (email: string) => signupEnabled || configuredEmails.has(email.trim().toLowerCase()) || hasPendingInvitation(email),
    canCreateWorkspaces: (userId: string) => signupEnabled || isInstallationAdmin(userId),
    qualifies: (userId: string) => {
      if (signupEnabled || isInstallationAdmin(userId)) return true;
      const user = account(userId);

      return Boolean(user && (hasPendingInvitation(user.email) || (hasTable("workspace_memberships") && database.query(
        "SELECT 1 FROM workspace_memberships WHERE user_id = ? LIMIT 1",
      ).get(userId))));
    },
  };
}
