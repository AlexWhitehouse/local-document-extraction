import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalAuth, localTrustedOrigins } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import type { LocalMailMessage } from "./localMailSink";

test("email/password sign-up captures an Account email verification link", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        capturedMessages.push(message);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  try {
    const response = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "Strong1!",
      }),
    }));

    expect(response.status).toBe(200);
    expect(capturedMessages).toEqual([
      expect.objectContaining({
        type: "account_email_verification",
        to: "ada@example.com",
        subject: "Verify your Document Extraction account",
      }),
    ]);
    expect(capturedMessages[0]?.text).toContain("/api/auth/verify-email?");
  } finally {
    database.close();
  }
});

test("auth trusts configured origins without a maintainer deployment", () => {
  expect(localTrustedOrigins("http://127.0.0.1:9999")).toContain("http://localhost:9999");
  expect(localTrustedOrigins("https://app.example.org", ["https://admin.example.org"])).toEqual(["https://app.example.org", "https://admin.example.org"]);
});

test("Better Auth records the Cloudflare connecting IP only when its header is explicitly trusted", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    trustedIpHeaders: ["cf-connecting-ip"],
    database,
    mailSink: { capture: async (message) => { capturedMessages.push(message); } },
    secret: "01234567890123456789012345678901",
  });

  try {
    await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const verificationUrl = capturedMessages[0]?.text.match(/https?:\/\/\S+/)?.[0];
    await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));

    const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));

    expect(signIn.status).toBe(200);
    expect(database.query("SELECT ipAddress FROM session ORDER BY createdAt DESC LIMIT 1").get())
      .toEqual({ ipAddress: "203.0.113.42" });
  } finally {
    database.close();
  }
});

test("the local Fetch application delegates email/password sign-up to Better Auth", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        capturedMessages.push(message);
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const application = createLocalApplication({ auth });

  try {
    const response = await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "Strong1!",
      }),
    }));

    expect(response.status).toBe(200);
    expect(capturedMessages).toHaveLength(1);
  } finally {
    database.close();
  }
});

test("the local Fetch application applies the Account password policy before Better Auth", async () => {
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const application = createLocalApplication({ auth });

  try {
    const response = await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "password" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "password_policy_not_met",
        message: "Password must meet all complexity requirements.",
      },
    });
  } finally {
    database.close();
  }
});

test("unverified accounts stay blocked until their captured verification link is consumed", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        capturedMessages.push(message);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  try {
    await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));

    const unverifiedSignIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    expect(unverifiedSignIn.ok).toBe(false);

    const verificationUrl = capturedMessages[0]?.text.match(/https?:\/\/\S+/)?.[0];
    expect(verificationUrl).toBeDefined();
    const verificationResponse = await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));
    expect(verificationResponse.status).toBe(302);

    const verifiedSignIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    expect(verifiedSignIn.status).toBe(200);
  } finally {
    database.close();
  }
});

test("Better Auth updates the signed-in user's profile name and refreshes the session", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async (message) => { capturedMessages.push(message); } },
    secret: "01234567890123456789012345678901",
  });

  try {
    await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const verificationUrl = capturedMessages[0]?.text.match(/https?:\/\/\S+/)?.[0];
    await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));
    const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]!;

    const updated = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Ada Byron" }),
    }));

    expect(updated.status).toBe(200);
    await expect(auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } })))
      .resolves.toMatchObject({ name: "Ada Byron", email: "ada@example.com" });
  } finally {
    database.close();
  }
});

test("password reset requests do not disclose account existence and captured reset links change the password", async () => {
  const database = new Database(":memory:");
  const capturedMessages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        capturedMessages.push(message);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  try {
    await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const verificationUrl = capturedMessages[0]?.text.match(/https?:\/\/\S+/)?.[0];
    await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));

    const knownRequest = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", redirectTo: "/reset-password" }),
    }));
    const unknownRequest = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com", redirectTo: "/reset-password" }),
    }));

    expect(knownRequest.status).toBe(unknownRequest.status);
    await expect(knownRequest.text()).resolves.toBe(await unknownRequest.text());

    const resetUrl = capturedMessages.find((message) => message.type === "account_password_reset")?.text.match(/https?:\/\/\S+/)?.[0];
    const token = new URL(resetUrl!).pathname.split("/").at(-1);
    const resetResponse = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: "Updated1!" }),
    }));
    expect(resetResponse.status).toBe(200);

    const updatedSignIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Updated1!" }),
    }));
    expect(updatedSignIn.status).toBe(200);
  } finally {
    database.close();
  }
});

test("configured local admin emails receive persisted Application admin sessions", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    adminEmails: ["admin@example.com"],
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async (message) => { messages.push(message); } },
    secret: "01234567890123456789012345678901",
  });
  try {
    await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "Strong1!" }) }));
    const verificationUrl = messages[0]?.text.match(/https?:\/\/\S+/)?.[0];
    await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));
    const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "Strong1!" }) }));
    const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie: signIn.headers.get("set-cookie")?.split(";", 1)[0]! } }));
    expect(session?.role).toBe("admin");
  } finally { database.close(); }
});

test("Better Auth admin routes authorize persisted Application admins and reject regular users", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    const userCookie = await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const adminList = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/admin/list-users?limit=10", { headers: { cookie: adminCookie } }));
    const userList = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/admin/list-users?limit=10", { headers: { cookie: userCookie } }));
    expect(adminList.status).toBe(200);
    expect(userList.status).toBe(403);
  } finally { database.close(); }
});

test("Application admins can search local accounts through Better Auth", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "Ada", "ada@example.com");
    await createVerifiedCookie(auth, messages, "Grace", "grace@example.com");

    const response = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/admin/list-users?searchField=email&searchOperator=starts_with&searchValue=ada%40&limit=10", { headers: { cookie: adminCookie } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      total: 1,
      users: [expect.objectContaining({ email: "ada@example.com" })],
    }));
  } finally { database.close(); }
});

test("Application admins can promote and demote another local account", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const promoted = await auth.handler(adminRequest("/api/auth/admin/set-role", adminCookie, { userId: user.id, role: "admin" }));
    expect(promoted.status).toBe(200);
    await expect(promoted.json()).resolves.toEqual(expect.objectContaining({ user: expect.objectContaining({ id: user.id, role: "admin" }) }));

    const demoted = await auth.handler(adminRequest("/api/auth/admin/set-role", adminCookie, { userId: user.id, role: "user" }));
    expect(demoted.status).toBe(200);
    await expect(demoted.json()).resolves.toEqual(expect.objectContaining({ user: expect.objectContaining({ id: user.id, role: "user" }) }));
  } finally { database.close(); }
});

test("Application admins cannot change their own local role", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    const admin = await findUserByEmail(auth, adminCookie, "admin@example.com");

    const response = await auth.handler(adminRequest("/api/auth/admin/set-role", adminCookie, { userId: admin.id, role: "user" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "local_admin_self_role_change_not_allowed",
      message: "Application admins cannot change their own role.",
    });
  } finally { database.close(); }
});

test("Application admins can ban a local account with a reason", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const response = await auth.handler(adminRequest("/api/auth/admin/ban-user", adminCookie, { userId: user.id, banReason: "Compromised credentials" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      user: expect.objectContaining({ id: user.id, banned: true, banReason: "Compromised credentials" }),
    }));
  } finally { database.close(); }
});

test("Application admins must give a reason when banning a local account", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const response = await auth.handler(adminRequest("/api/auth/admin/ban-user", adminCookie, { userId: user.id, banReason: "   " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "local_admin_ban_reason_required",
      message: "A ban reason is required.",
    });
  } finally { database.close(); }
});

test("Application admins can unban a local account so it can sign in again", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");
    await auth.handler(adminRequest("/api/auth/admin/ban-user", adminCookie, { userId: user.id, banReason: "Compromised credentials" }));

    const unban = await auth.handler(adminRequest("/api/auth/admin/unban-user", adminCookie, { userId: user.id }));
    expect(unban.status).toBe(200);
    await expect(unban.json()).resolves.toEqual(expect.objectContaining({
      user: expect.objectContaining({ id: user.id, banned: false, banReason: null }),
    }));

    const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "Strong1!" }),
    }));
    expect(signIn.status).toBe(200);
  } finally { database.close(); }
});

test("Application admins can impersonate a regular local account and stop impersonating", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const impersonate = await auth.handler(adminRequest("/api/auth/admin/impersonate-user", adminCookie, { userId: user.id }));
    expect(impersonate.status).toBe(200);
    const impersonatedCookies = activeAuthCookies(impersonate);
    const impersonatedSession = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie: impersonatedCookies } }));
    expect(impersonatedSession).toEqual(expect.objectContaining({ id: user.id, email: "user@example.com", role: "user" }));

    const stop = await auth.handler(adminRequest("/api/auth/admin/stop-impersonating", impersonatedCookies, {}));
    expect(stop.status).toBe(200);
    const restoredCookies = activeAuthCookies(stop);
    const restoredSession = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie: restoredCookies } }));
    expect(restoredSession).toEqual(expect.objectContaining({ email: "admin@example.com", role: "admin" }));
  } finally { database.close(); }
});

test("regular local accounts cannot perform Application admin actions", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    const userCookie = await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const admin = await findUserByEmail(auth, adminCookie, "admin@example.com");

    const response = await auth.handler(adminRequest("/api/auth/admin/set-role", userCookie, { userId: admin.id, role: "user" }));

    expect(response.status).toBe(403);
  } finally { database.close(); }
});

test("Application admins can only impersonate active regular local accounts", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const admin = await findUserByEmail(auth, adminCookie, "admin@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const adminTarget = await auth.handler(adminRequest("/api/auth/admin/impersonate-user", adminCookie, { userId: admin.id }));
    expect(adminTarget.status).toBe(403);

    await auth.handler(adminRequest("/api/auth/admin/ban-user", adminCookie, { userId: user.id, banReason: "Compromised credentials" }));
    const bannedTarget = await auth.handler(adminRequest("/api/auth/admin/impersonate-user", adminCookie, { userId: user.id }));
    expect(bannedTarget.status).toBe(403);
  } finally { database.close(); }
});

test("Application admins can only assign local Application roles", async () => {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({ requireEmailVerification: true, adminEmails: ["admin@example.com"], baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push(message); } }, secret: "01234567890123456789012345678901" });
  try {
    const adminCookie = await createVerifiedCookie(auth, messages, "Admin", "admin@example.com");
    await createVerifiedCookie(auth, messages, "User", "user@example.com");
    const user = await findUserByEmail(auth, adminCookie, "user@example.com");

    const response = await auth.handler(adminRequest("/api/auth/admin/set-role", adminCookie, { userId: user.id, role: "operator" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "local_application_role_not_allowed",
      message: "Application roles must be admin or user.",
    });
  } finally { database.close(); }
});

async function createVerifiedCookie(auth: Awaited<ReturnType<typeof createLocalAuth>>, messages: LocalMailMessage[], name: string, email: string): Promise<string> {
  await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, password: "Strong1!" }) }));
  const verificationUrl = messages.filter((message) => message.to === email).at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));
  const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Strong1!" }) }));
  return signIn.headers.get("set-cookie")?.split(";", 1)[0]!;
}

function adminRequest(path: string, cookie: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function findUserByEmail(auth: Awaited<ReturnType<typeof createLocalAuth>>, adminCookie: string, email: string): Promise<{ id: string; role: string }> {
  const response = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/admin/list-users?limit=100", { headers: { cookie: adminCookie } }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { users: Array<{ id: string; email: string; role: string }> };
  const user = payload.users.find((candidate) => candidate.email === email);
  expect(user).toBeDefined();
  return user!;
}

function activeAuthCookies(response: Response): string {
  const cookies = response.headers.getSetCookie()
    .filter((value) => /^(better-auth\.(session_token|admin_session))=/.test(value) && !value.includes("Max-Age=0"))
    .map((value) => value.split(";", 1)[0]!);
  expect(cookies).not.toHaveLength(0);
  return cookies.join("; ");
}
