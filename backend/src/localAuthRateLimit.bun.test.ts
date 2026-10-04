import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocalAuth } from "./localAuth";
import { boundLocalApiBody } from "./localApiBodyLimit";
import { setLocalAuthRequestPeerAddress } from "./localAuthClientAddress";

const origin = "http://127.0.0.1:8787";

async function fixture(trustedIpHeaders: string[] = []) {
  const database = new Database(":memory:");

  const auth = await createLocalAuth({
    database,
    baseURL: origin,
    trustedIpHeaders,
    secret: "synthetic-test-only-secret-for-auth-limits",
    mailSink: { capture: async () => {} },
  });

  const application = async (request: Request) => auth.handler(await boundLocalApiBody(request, 1024));

  const signIn = async (
    headers: Record<string, string> = {},
    peerAddress?: string,
    path = "/api/auth/sign-in/email",
  ) => {
    const request = new Request(`${origin}${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify({ email: "missing@example.test", password: "Incorrect1!" }),
    });

    if (peerAddress) setLocalAuthRequestPeerAddress(request, peerAddress);
    const response = await application(request);
    await response.text();

    return response;
  };

  return { database, signIn };
}

test("authentication limits apply outside production before repeated password hashing", async () => {
  const f = await fixture();

  try {
    for (let attempt = 0; attempt < 3; attempt++) expect((await f.signIn()).status).toBe(401);
    const blocked = await f.signIn();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
  } finally {
    f.database.close();
  }
});

test("separate authentication runtimes do not share an installation's attempt budget", async () => {
  const first = await fixture(["x-audit-client"]);
  const second = await fixture(["x-audit-client"]);
  const headers = { "x-audit-client": "192.0.2.20" };

  try {
    for (let attempt = 0; attempt < 3; attempt++) expect((await first.signIn(headers)).status).toBe(401);
    expect((await first.signIn(headers)).status).toBe(429);
    expect((await second.signIn(headers)).status).toBe(401);
  } finally {
    first.database.close();
    second.database.close();
  }
});

test("transport peers have separate budgets and cannot spoof their address with headers", async () => {
  const f = await fixture();

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        (
          await f.signIn(
            {
              "x-forwarded-for": `192.0.2.${attempt + 1}`,
              "cf-connecting-ip": `198.51.100.${attempt + 1}`,
              "x-document-extraction-client-address": `203.0.113.${attempt + 1}`,
            },
            "192.0.2.40",
          )
        ).status,
      ).toBe(401);
    }

    expect(
      (
        await f.signIn(
          { "x-forwarded-for": "203.0.113.90", "x-document-extraction-client-address": "203.0.113.91" },
          "192.0.2.40",
        )
      ).status,
    ).toBe(429);
    expect((await f.signIn({}, "192.0.2.41")).status).toBe(401);
  } finally {
    f.database.close();
  }
});

test("configured proxy addresses separate clients while invalid or appended chains fall back to the peer", async () => {
  const f = await fixture(["x-forwarded-for"]);

  try {
    for (let attempt = 0; attempt < 3; attempt++)
      expect((await f.signIn({ "x-forwarded-for": "203.0.113.10" }, "192.0.2.50")).status).toBe(401);
    expect((await f.signIn({ "x-forwarded-for": "203.0.113.10" }, "192.0.2.50")).status).toBe(429);
    expect((await f.signIn({ "x-forwarded-for": "203.0.113.11" }, "192.0.2.50")).status).toBe(401);

    for (const forwarded of ["not-an-address", "203.0.113.20, 192.0.2.50", "203.0.113.21, 192.0.2.50"]) {
      expect((await f.signIn({ "x-forwarded-for": forwarded }, "192.0.2.50")).status).toBe(401);
    }

    expect((await f.signIn({ "x-forwarded-for": "203.0.113.22, 192.0.2.50" }, "192.0.2.50")).status).toBe(429);
    expect((await f.signIn({ "x-forwarded-for": "invalid" }, "192.0.2.51")).status).toBe(401);
  } finally {
    f.database.close();
  }
});

test("IPv6 equivalent addresses and addresses in one subnet share their attempt budget", async () => {
  const f = await fixture();

  try {
    for (const address of ["2001:db8:1::1", "2001:0DB8:0001:0000:0000:0000:0000:0001", "2001:db8:1::2"]) {
      expect((await f.signIn({}, address)).status).toBe(401);
    }

    expect((await f.signIn({}, "2001:db8:1::ffff")).status).toBe(429);
    expect((await f.signIn({}, "2001:db8:2::1")).status).toBe(401);

    for (const address of ["192.0.2.70", "::ffff:192.0.2.70", "::ffff:c000:0246"]) {
      expect((await f.signIn({}, address)).status).toBe(401);
    }

    expect((await f.signIn({}, "192.0.2.70")).status).toBe(429);
  } finally {
    f.database.close();
  }
});

test("concurrent login attempts cannot race past the sensitive endpoint limit", async () => {
  const f = await fixture();

  try {
    const responses = await Promise.all(Array.from({ length: 10 }, () => f.signIn({}, "192.0.2.80")));
    expect(responses.filter((response) => response.status === 401)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
  } finally {
    f.database.close();
  }
});

test("alternate spellings of an exhausted auth route cannot create fresh login budgets", async () => {
  const f = await fixture();

  try {
    for (let attempt = 0; attempt < 3; attempt++) expect((await f.signIn({}, "192.0.2.90")).status).toBe(401);

    for (const path of [
      "/api/auth/sign-in/email/",
      "/api/auth/sign-in/email?attempt=2",
      "/api/auth/sign-in/%65mail",
      "/api/auth/%73ign-in/email",
    ]) {
      expect([404, 429]).toContain((await f.signIn({}, "192.0.2.90", path)).status);
    }
  } finally {
    f.database.close();
  }
});
