import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocalAuth, type LocalAuthSettings } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalMailMessage } from "./localMailSink";

const origin = "http://127.0.0.1:8787";
const signup = () => new Request(`${origin}/api/auth/sign-up/email`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Ada", email: "ada@example.org", password: "Strong1!" }),
});
async function fixture(settings: LocalAuthSettings = {}) {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const auth = await createLocalAuth({
    ...settings, baseURL: origin, database,
    googleClientId: "test-google-client", googleClientSecret: "test-google-secret",
    secret: "01234567890123456789012345678901",
    mailSink: { capture: async (message) => { messages.push(message); } },
  });
  return { database, messages, auth };
}

test("default signup establishes a session and bootstraps a Workspace without mail", async () => {
  const { database, messages, auth } = await fixture();
  try {
    const response = await auth.handler(signup());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { emailVerified: false } });
    expect(messages).toHaveLength(0);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).not.toBe("");
    const application = createLocalApplication({ auth, workspaceControl: createLocalWorkspaceControl(database) });
    const workspaces = await application(new Request(`${origin}/v1/workspaces`, { headers: { cookie } }));
    expect(workspaces.status).toBe(200);
    expect(await workspaces.json()).toMatchObject({ workspaces: [expect.objectContaining({ role: "owner" })] });
    const signIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.org", password: "Strong1!" }),
    }));
    expect(signIn.status).toBe(200);
    expect(signIn.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(messages).toHaveLength(0);
  } finally { database.close(); }
});

test("closed registration and disabled password login block signup without creating accounts", async () => {
  for (const settings of [{ signupEnabled: false }, { emailPasswordEnabled: false, googleEnabled: true }]) {
    const { database, messages, auth } = await fixture(settings);
    try {
      const response = await auth.handler(signup());
      expect(response.status).toBe(400);
      expect(database.query("SELECT count(*) AS count FROM user").get()).toEqual({ count: 0 });
      expect(messages).toHaveLength(0);
    } finally { database.close(); }
  }
});

test("Google login needs explicit enablement even when a complete credential pair is present", async () => {
  for (const googleEnabled of [false, true]) {
    const { database, auth } = await fixture({ googleEnabled, signupEnabled: false });
    try {
      const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: origin }),
      }));
      expect(response.status).toBe(googleEnabled ? 200 : 404);
      if (googleEnabled) expect(new URL((await response.json() as { url: string }).url).hostname).toBe("accounts.google.com");
    } finally { database.close(); }
  }
});

test("verification uses the configured sender and ignores untrusted forwarding headers", async () => {
  const { database, messages, auth } = await fixture({ requireEmailVerification: true, emailFrom: { email: "support@example.org", name: "My App" } });
  try {
    await auth.handler(signup());
    expect(messages[0]?.from).toEqual({ email: "support@example.org", name: "My App" });
    const url = messages[0]!.text.match(/https?:\/\/\S+/)![0];
    await auth.handler(new Request(url, { redirect: "manual" }));
    await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.42", "x-forwarded-for": "203.0.113.99" },
      body: JSON.stringify({ email: "ada@example.org", password: "Strong1!" }),
    }));
    const sessions = database.query("SELECT ipAddress FROM session").all();
    expect(JSON.stringify(sessions)).not.toContain("203.0.113");
  } finally { database.close(); }
});

test("closed Google registration rejects new identities while existing Google accounts can sign in", async () => {
  const originalFetch = globalThis.fetch;
  const database = new Database(":memory:");
  let identity = "existing";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== "https://oauth2.googleapis.com/token") throw new Error("Unexpected OAuth network request");
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none" })}.${encode({ sub: identity, email: `${identity}@example.org`, email_verified: true, name: "Google User" })}.test`;
    return Response.json({ access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600, id_token: token });
  }) as typeof fetch;
  try {
    const authFor = (signupEnabled: boolean) => createLocalAuth({
      baseURL: origin, database, signupEnabled, googleEnabled: true,
      googleClientId: "test-google-client", googleClientSecret: "test-google-secret",
      secret: "01234567890123456789012345678901", mailSink: { capture: async () => {} },
    });
    const completeGoogleLogin = async (signupEnabled: boolean) => {
      const auth = await authFor(signupEnabled);
      const start = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: origin, requestSignUp: true }),
      }));
      const state = new URL((await start.json() as { url: string }).url).searchParams.get("state")!;
      const cookie = start.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      return auth.handler(new Request(`${origin}/api/auth/callback/google?code=mock-code&state=${encodeURIComponent(state)}`, { headers: { cookie } }));
    };
    const created = await completeGoogleLogin(true);
    expect(created.headers.get("location")).toBe(origin);
    expect(database.query("SELECT count(*) AS count FROM user").get()).toEqual({ count: 1 });
    const existing = await completeGoogleLogin(false);
    expect(existing.headers.get("location")).toBe(origin);
    identity = "new";
    const blocked = await completeGoogleLogin(false);
    expect(blocked.headers.get("location")).toContain("signup_disabled");
    expect(database.query("SELECT count(*) AS count FROM user").get()).toEqual({ count: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});
