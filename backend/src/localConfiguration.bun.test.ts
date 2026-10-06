import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { publicLocalConfiguration, readLocalConfiguration } from "./localConfiguration";

const read = (environment: Record<string, string | undefined> = {}) =>
  readLocalConfiguration({
    environment,
    repositoryRoot: "/tmp/document-extraction-config-test",
    totalMemoryBytes: 1024 ** 3,
  });

test("a clean local install has usable private defaults and a secret-free public configuration", () => {
  const config = read();
  expect(config.stateDirectory).toBe("/tmp/document-extraction-config-test/.local");
  expect(config.host).toBe("127.0.0.1");
  expect(config.extractionMaxConcurrency).toBe(8);
  expect(config.extractionMaximumConcurrency).toBe(8);
  expect(config.extractionAdaptiveConcurrency).toBe(true);
  expect(config.submissionMaxConcurrency).toBe(24);
  expect(config.submissionMaxReservedBytes).toBe(288 * 1024 * 1024);
  expect(config.extractionMaxBuffered).toBe(10000);
  expect(publicLocalConfiguration(config)).toEqual({
    auth: {
      emailPasswordEnabled: true,
      googleEnabled: false,
      signupEnabled: true,
      requireEmailVerification: false,
      mailDelivery: "local",
    },
    limits: { maxSourceFileBytes: 10485760 },
    sourceStorage: { configured: false, retainsOriginals: false },
  });
  expect(config.sourceStorage).toEqual({ provider: "none", originalRetentionEnabled: false });
});

test("selecting local Source storage retains originals by default and can be turned off for new uploads", () => {
  expect(read({ SOURCE_STORAGE_PROVIDER: "local" }).sourceStorage).toEqual({
    provider: "local",
    originalRetentionEnabled: true,
  });
  expect(read({ SOURCE_STORAGE_PROVIDER: "local", SOURCE_ORIGINAL_RETENTION_ENABLED: "false" }).sourceStorage).toEqual({
    provider: "local",
    originalRetentionEnabled: false,
  });
  expect(publicLocalConfiguration(read({ SOURCE_STORAGE_PROVIDER: "local" })).sourceStorage).toEqual({
    configured: true,
    retainsOriginals: true,
  });
});

test("Source storage settings reject retention without a store and unsupported providers", () => {
  expect(() => read({ SOURCE_ORIGINAL_RETENTION_ENABLED: "true" })).toThrow("requires SOURCE_STORAGE_PROVIDER");
  expect(() => read({ SOURCE_STORAGE_PROVIDER: "s3" })).toThrow("requires SOURCE_STORAGE_S3_BUCKET");
  expect(() => read({ SOURCE_STORAGE_PROVIDER: "ftp" })).toThrow("must be none, local or s3");
});

test("S3 Source storage reads a private destination and keeps credentials out of the public configuration", () => {
  const s3 = {
    SOURCE_STORAGE_PROVIDER: "s3",
    SOURCE_STORAGE_S3_BUCKET: "document-extraction-qual",
    SOURCE_STORAGE_S3_REGION: "us-east-1",
    SOURCE_STORAGE_S3_ENDPOINT: "http://vps-hetzner:9000/",
    SOURCE_STORAGE_S3_ACCESS_KEY_ID: "private-access",
    SOURCE_STORAGE_S3_SECRET_ACCESS_KEY: "private-secret",
  };

  const config = read(s3);
  expect(config.sourceStorage).toEqual({
    provider: "s3",
    originalRetentionEnabled: true,
    s3: {
      bucket: "document-extraction-qual",
      region: "us-east-1",
      endpoint: "http://vps-hetzner:9000",
      prefix: "document-extraction/",
      forcePathStyle: true,
      accessKeyId: "private-access",
      secretAccessKey: "private-secret",
      sessionToken: undefined,
    },
  });
  expect(JSON.stringify(publicLocalConfiguration(config))).not.toMatch(/private-|hetzner|qual/);
  expect(read({ ...s3, SOURCE_STORAGE_S3_ENDPOINT: undefined }).sourceStorage.s3?.forcePathStyle).toBe(false);
  expect(() => read({ ...s3, SOURCE_STORAGE_S3_ENDPOINT: "http://user:pass@host:9000" })).toThrow(
    "SOURCE_STORAGE_S3_ENDPOINT",
  );
  expect(() => read({ ...s3, SOURCE_STORAGE_S3_PREFIX: "../escape/" })).toThrow("SOURCE_STORAGE_S3_PREFIX");
  expect(() => read({ ...s3, SOURCE_STORAGE_S3_BUCKET: "Bad_Bucket" })).toThrow("valid S3 bucket name");
});

test("configured deployment and secret values remain outside the public response", () => {
  const config = read({
    AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
    AUTH_GOOGLE_ENABLED: "yes",
    GOOGLE_CLIENT_ID: "private-client",
    GOOGLE_CLIENT_SECRET: "private-secret",
    EMAIL_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_EMAIL_API_TOKEN: "private-mail-token",
    EMAIL_FROM_ADDRESS: "mail@example.org",
    AUTH_TRUSTED_ORIGINS: "https://app.example.org/,https://admin.example.org",
    AUTH_TRUSTED_IP_HEADERS: "CF-Connecting-IP",
    AUTH_EMAIL_PASSWORD_ENABLED: "false",
    AUTH_SIGNUP_ENABLED: "off",
    BETTER_AUTH_URL: "https://app.example.org/",
    DOCUMENT_EXTRACTION_STATE_DIR: "runtime-state",
  });

  expect(publicLocalConfiguration(config).auth.requireEmailVerification).toBe(true);
  expect(config.auth.trustedOrigins).toEqual(["https://app.example.org", "https://admin.example.org"]);
  expect(config.auth.trustedIpHeaders).toEqual(["cf-connecting-ip"]);
  expect(config.stateDirectory).toBe("/tmp/document-extraction-config-test/runtime-state");
  expect(JSON.stringify(publicLocalConfiguration(config))).not.toMatch(/private-|example\.org|aaaaaaaa/);
});

test("invalid environment values fail with variable names, never supplied values", () => {
  const cases = [
    ["AUTH_GOOGLE_ENABLED", "private-invalid"],
    ["PORT", "-1"],
    ["PORT", "65536"],
    ["PORT", "1.5"],
    ["MAX_SOURCE_FILE_BYTES", "9007199254740992"],
    ["EXTRACTION_ADAPTIVE_CONCURRENCY", "typo"],
    ["LOCAL_MEMORY_LIMIT_RATIO", "NaN"],
    ["LOCAL_CPU_LIMIT_RATIO", "1.1"],
    ["MODEL_GATEWAY_REQUEST_TIMEOUT_MS", "0"],
    ["MODEL_GATEWAY_REQUEST_TIMEOUT_MS", "2147483648"],
    ["MAX_JSON_REQUEST_BYTES", "-1"],
    ["BETTER_AUTH_URL", "https://user:private-secret@example.org/path"],
    ["AUTH_TRUSTED_ORIGINS", "https://*.example.org"],
    ["AUTH_TRUSTED_IP_HEADERS", "x-ip: invalid"],
    ["HOST", "http://localhost:8080"],
    ["EMAIL_PROVIDER", "private-invalid"],
    ["EMAIL_FROM_ADDRESS", "private-invalid"],
    ["MODEL_PREPARATION_MAX_BYTES", "999999999999"],
  ];

  for (const [name, value] of cases) {
    let error: unknown;

    try {
      read({ [name!]: value! });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);

    if (!(error instanceof Error)) throw new Error("Expected a configuration error");
    expect(error.message).toContain(name!);

    if (!(error instanceof Error)) throw new Error("Expected a configuration error");
    expect(error.message).not.toContain("private-");
  }
});

test("provider completeness and capacity relationships are checked before startup", () => {
  for (const environment of [
    { GOOGLE_CLIENT_ID: "client" },
    { AUTH_GOOGLE_ENABLED: "true" },
    { AUTH_EMAIL_PASSWORD_ENABLED: "false" },
    { EMAIL_PROVIDER: "cloudflare" },
    { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) },
    { MAX_SOURCE_FILE_BYTES: String(288 * 1024 * 1024) },
    { EXTRACTION_MAX_CONCURRENCY: "33" },
  ])
    expect(() => read(environment)).toThrow();
  expect(
    read({ MAX_SOURCE_FILE_BYTES: "200000000", SUBMISSION_MAX_RESERVED_BYTES: "200040960" }).maxSourceFileBytes,
  ).toBe(200000000);
  expect(
    read({
      EXTRACTION_MAX_CONCURRENCY: "8",
      EXTRACTION_MAX_CONCURRENCY_LIMIT: "16",
      EXTRACTION_ADAPTIVE_CONCURRENCY: "false",
    }),
  ).toMatchObject({
    extractionMaxConcurrency: 8,
    extractionMaximumConcurrency: 16,
    extractionAdaptiveConcurrency: false,
  });
  expect(
    read({ SUBMISSION_MAX_CONCURRENCY: "5", SUBMISSION_MAX_RESERVED_BYTES: String(64 * 1024 * 1024) }),
  ).toMatchObject({ submissionMaxConcurrency: 5, submissionMaxReservedBytes: 64 * 1024 * 1024 });
});

test("state configuration cannot chmod shared filesystem roots", () => {
  for (const directory of ["/", ".", homedir(), tmpdir(), "/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"])
    expect(() => read({ DOCUMENT_EXTRACTION_STATE_DIR: directory })).toThrow("dedicated application state");
});

test("Go local concurrency scales with CPU and response memory, independently of provider capacity", () => {
  const environment = { GO_MODEL_CONCURRENCY: "1500" };
  const large = readLocalConfiguration({ environment, cpuCount: 6, totalMemoryBytes: 12 * 1024 ** 3 });
  expect(large.extractionMaxConcurrency).toBe(96);
  expect(large.extractionMaximumConcurrency).toBe(96);
  const small = readLocalConfiguration({ environment, cpuCount: 6, totalMemoryBytes: 1024 ** 3 });
  expect(small.extractionMaxConcurrency).toBe(8);
  const explicit = readLocalConfiguration({ environment: { ...environment, EXTRACTION_MAX_CONCURRENCY: "12" }, cpuCount: 6, totalMemoryBytes: 12 * 1024 ** 3 });
  expect(explicit.extractionMaxConcurrency).toBe(12);
});
