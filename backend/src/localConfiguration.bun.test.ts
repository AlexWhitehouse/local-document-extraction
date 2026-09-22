import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { publicLocalConfiguration, readLocalConfiguration } from "./localConfiguration";

const read = (environment: Record<string, string | undefined> = {}) => readLocalConfiguration({ environment, repositoryRoot: "/tmp/document-extraction-config-test", totalMemoryBytes: 1024 ** 3 });

test("a clean local install has usable private defaults and a secret-free public configuration", () => {
  const config = read();
  expect(config.stateDirectory).toBe("/tmp/document-extraction-config-test/.local");
  expect(config.host).toBe("127.0.0.1");
  expect(publicLocalConfiguration(config)).toEqual({
    auth: { emailPasswordEnabled: true, googleEnabled: false, signupEnabled: true, requireEmailVerification: false, mailDelivery: "local" },
    limits: { maxSourceFileBytes: 10485760 },
  });
});

test("configured deployment and secret values remain outside the public response", () => {
  const config = read({
    AUTH_REQUIRE_EMAIL_VERIFICATION: "true", AUTH_GOOGLE_ENABLED: "yes", GOOGLE_CLIENT_ID: "private-client", GOOGLE_CLIENT_SECRET: "private-secret",
    EMAIL_PROVIDER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_EMAIL_API_TOKEN: "private-mail-token",
    EMAIL_FROM_ADDRESS: "mail@example.org", AUTH_TRUSTED_ORIGINS: "https://app.example.org/,https://admin.example.org",
    AUTH_TRUSTED_IP_HEADERS: "CF-Connecting-IP", AUTH_EMAIL_PASSWORD_ENABLED: "false", AUTH_SIGNUP_ENABLED: "off",
    BETTER_AUTH_URL: "https://app.example.org/", DOCUMENT_EXTRACTION_STATE_DIR: "runtime-state",
  });
  expect(publicLocalConfiguration(config).auth.requireEmailVerification).toBe(true);
  expect(config.auth.trustedOrigins).toEqual(["https://app.example.org", "https://admin.example.org"]);
  expect(config.auth.trustedIpHeaders).toEqual(["cf-connecting-ip"]);
  expect(config.stateDirectory).toBe("/tmp/document-extraction-config-test/runtime-state");
  expect(JSON.stringify(publicLocalConfiguration(config))).not.toMatch(/private-|example\.org|aaaaaaaa/);
});

test("invalid environment values fail with variable names, never supplied values", () => {
  const cases = [
    ["AUTH_GOOGLE_ENABLED", "private-invalid"], ["PORT", "-1"], ["PORT", "65536"], ["PORT", "1.5"],
    ["MAX_SOURCE_FILE_BYTES", "9007199254740992"], ["EXTRACTION_ADAPTIVE_CONCURRENCY", "typo"],
    ["LOCAL_MEMORY_LIMIT_RATIO", "NaN"], ["LOCAL_CPU_LIMIT_RATIO", "1.1"],
    ["MODEL_GATEWAY_REQUEST_TIMEOUT_MS", "0"], ["MODEL_GATEWAY_REQUEST_TIMEOUT_MS", "2147483648"],
    ["MAX_JSON_REQUEST_BYTES", "-1"], ["BETTER_AUTH_URL", "https://user:private-secret@example.org/path"],
    ["AUTH_TRUSTED_ORIGINS", "https://*.example.org"], ["AUTH_TRUSTED_IP_HEADERS", "x-ip: invalid"],
    ["HOST", "http://localhost:8080"], ["EMAIL_PROVIDER", "private-invalid"],
    ["EMAIL_FROM_ADDRESS", "private-invalid"], ["MODEL_PREPARATION_MAX_BYTES", "999999999999"],
  ];
  for (const [name, value] of cases) {
    let error: unknown;
    try { read({ [name!]: value! }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(name!);
    expect((error as Error).message).not.toContain("private-");
  }
});

test("provider completeness and capacity relationships are checked before startup", () => {
  for (const environment of [
    { GOOGLE_CLIENT_ID: "client" },
    { AUTH_GOOGLE_ENABLED: "true" },
    { AUTH_EMAIL_PASSWORD_ENABLED: "false" },
    { EMAIL_PROVIDER: "cloudflare" },
    { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) },
    { MAX_SOURCE_FILE_BYTES: String(128 * 1024 * 1024) },
    { EXTRACTION_MAX_CONCURRENCY: "33" },
  ]) expect(() => read(environment)).toThrow();
  expect(read({ MAX_SOURCE_FILE_BYTES: "200000000", SUBMISSION_MAX_RESERVED_BYTES: "200032768" }).maxSourceFileBytes).toBe(200000000);
});

test("state configuration cannot chmod shared filesystem roots", () => {
  for (const directory of ["/", ".", homedir(), tmpdir(), "/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"]) expect(() => read({ DOCUMENT_EXTRACTION_STATE_DIR: directory })).toThrow("dedicated application state");
});
