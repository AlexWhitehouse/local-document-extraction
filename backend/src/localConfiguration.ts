import { dirname, resolve } from "node:path";
import { homedir, tmpdir, totalmem } from "node:os";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { localDocumentRequestBodyLimit } from "./localDocumentBodyLimit";

type Environment = Record<string, string | undefined>;
export type SourceStorageProvider = "none" | "local" | "s3";
export type S3SourceStorageConfiguration = {
  bucket: string;
  region: string;
  /** Custom S3-compatible endpoint origin; AWS S3 when absent. */
  endpoint?: string;
  forcePathStyle: boolean;
  /** Object key prefix owned by this installation, ending in "/". */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};
export type LocalSourceStorageConfiguration = {
  provider: SourceStorageProvider;
  /** Installation default for retaining originals of new uploads; Workspaces may opt out. */
  originalRetentionEnabled: boolean;
  s3?: S3SourceStorageConfiguration;
};

export type LocalEmailConfiguration = {
  provider: "local" | "cloudflare";
  fromAddress: string;
  fromName: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
};

/** Read deployment configuration without creating state or exposing supplied values in errors. */
export function readLocalConfiguration({
  environment: env = process.env,
  repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  totalMemoryBytes = totalmem(),
}: { environment?: Environment; repositoryRoot?: string; totalMemoryBytes?: number } = {}) {
  const text = (name: string) => env[name]?.trim() || undefined;
  const integer = (name: string, fallback: number, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => {
    const raw = text(name);
    const value = raw === undefined ? fallback : Number(raw);
    if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return value;
  };
  const boolean = (name: string, fallback: boolean) => {
    const value = text(name)?.toLowerCase();
    if (value === undefined) return fallback;
    if (["true", "1", "yes", "on"].includes(value)) return true;
    if (["false", "0", "no", "off"].includes(value)) return false;
    throw new Error(`${name} must be true or false.`);
  };
  const ratio = (name: string, fallback: number) => {
    const value = Number(text(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`${name} must be greater than zero and no greater than one.`);
    return value;
  };
  const list = (name: string) => [...new Set((text(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
  const secret = (name: string) => {
    const value = text(name);
    if (value && /[\r\n\0]/.test(value)) throw new Error(`${name} must not contain control characters.`);
    return value;
  };
  const origin = (value: string, name: string) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || value.includes("*")) throw new Error();
      return url.origin;
    } catch { throw new Error(`${name} must contain only complete HTTP(S) origins without credentials, paths, queries or wildcards.`); }
  };
  const emailAddress = (value: string, name: string) => {
    if (value.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)) throw new Error(`${name} must contain valid email addresses.`);
    return value;
  };
  const port = integer("PORT", 8787, 0, 65535);
  const host = text("HOST") ?? "127.0.0.1";
  if (!isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) throw new Error("HOST must be an IP address or hostname, without a port or URL scheme.");
  const stateDirectory = resolve(repositoryRoot, text("DOCUMENT_EXTRACTION_STATE_DIR") ?? ".local");
  const sharedDirectories = ["/", repositoryRoot, homedir(), tmpdir(), "/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"].map((directory) => resolve(directory));
  if (sharedDirectories.includes(stateDirectory)) throw new Error("DOCUMENT_EXTRACTION_STATE_DIR must be a dedicated application state directory, not the filesystem, repository, home or shared temporary root.");
  const emailPasswordEnabled = boolean("AUTH_EMAIL_PASSWORD_ENABLED", true);
  const googleEnabled = boolean("AUTH_GOOGLE_ENABLED", false);
  const googleClientId = secret("GOOGLE_CLIENT_ID");
  const googleClientSecret = secret("GOOGLE_CLIENT_SECRET");
  if (Boolean(googleClientId) !== Boolean(googleClientSecret) || (googleEnabled && !googleClientId)) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set when Google is configured; AUTH_GOOGLE_ENABLED requires both.");
  if (!emailPasswordEnabled && !googleEnabled) throw new Error("Enable AUTH_EMAIL_PASSWORD_ENABLED or AUTH_GOOGLE_ENABLED so users can sign in.");
  const trustedIpHeaders = list("AUTH_TRUSTED_IP_HEADERS").map((header) => header.toLowerCase());
  if (trustedIpHeaders.some((header) => !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(header))) throw new Error("AUTH_TRUSTED_IP_HEADERS must contain HTTP header names.");
  const provider = text("EMAIL_PROVIDER") ?? "local";
  if (provider !== "local" && provider !== "cloudflare") throw new Error("EMAIL_PROVIDER must be local or cloudflare.");
  const cloudflareAccountId = text("CLOUDFLARE_ACCOUNT_ID");
  const cloudflareApiToken = secret("CLOUDFLARE_EMAIL_API_TOKEN");
  if (Boolean(cloudflareAccountId) !== Boolean(cloudflareApiToken)) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN must both be set when Cloudflare email is configured.");
  if (cloudflareAccountId && !/^[a-fA-F0-9]{32}$/.test(cloudflareAccountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account identifier.");
  if (provider === "cloudflare" && (!cloudflareAccountId || !cloudflareApiToken || !text("EMAIL_FROM_ADDRESS"))) throw new Error("Cloudflare email requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN and EMAIL_FROM_ADDRESS.");
  const fromAddress = emailAddress(text("EMAIL_FROM_ADDRESS") ?? "no-reply@example.com", "EMAIL_FROM_ADDRESS");
  const fromName = text("EMAIL_FROM_NAME") ?? "Document Extraction";
  if (fromName.length > 200 || /[\r\n\0]/.test(fromName)) throw new Error("EMAIL_FROM_NAME must be a single line of at most 200 characters.");
  const maxSourceFileBytes = integer("MAX_SOURCE_FILE_BYTES", 10 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER - 65536);
  const submissionMaxReservedBytes = integer("SUBMISSION_MAX_RESERVED_BYTES", 128 * 1024 * 1024);
  if (submissionMaxReservedBytes < localDocumentRequestBodyLimit(maxSourceFileBytes)) throw new Error("SUBMISSION_MAX_RESERVED_BYTES must accommodate MAX_SOURCE_FILE_BYTES plus 40960 bytes of multipart overhead.");
  const extractionMaxConcurrency = integer("EXTRACTION_MAX_CONCURRENCY", 16);
  const extractionMaximumConcurrency = integer("EXTRACTION_MAX_CONCURRENCY_LIMIT", 32);
  if (extractionMaxConcurrency > extractionMaximumConcurrency) throw new Error("EXTRACTION_MAX_CONCURRENCY must not exceed EXTRACTION_MAX_CONCURRENCY_LIMIT.");
  const { memoryLimitRatio: localMemoryLimitRatio, preparationMaxBytes: modelPreparationMaxBytes } = readLocalMemoryLimits(env, totalMemoryBytes);
  const email: LocalEmailConfiguration = { provider, fromAddress, fromName, cloudflareAccountId, cloudflareApiToken };
  const sourceStorage = readSourceStorageConfiguration(text, boolean, secret);
  return {
    host, port, stateDirectory,
    assetsDirectory: resolve(repositoryRoot, text("DOCUMENT_EXTRACTION_ASSETS_DIR") ?? "frontend/dist"),
    maxSourceFileBytes,
    maxJsonRequestBytes: integer("MAX_JSON_REQUEST_BYTES", 1024 * 1024),
    extractionRetryDelayMs: integer("EXTRACTION_RETRY_DELAY_MS", 1000, 1, 2147483647),
    extractionMaxConcurrency,
    extractionMaximumConcurrency,
    extractionMaxBuffered: integer("EXTRACTION_MAX_BUFFERED", 10000),
    extractionReconcileIntervalMs: integer("EXTRACTION_RECONCILE_INTERVAL_MS", 60000, 1, 2147483647),
    submissionMaxConcurrency: integer("SUBMISSION_MAX_CONCURRENCY", 8),
    submissionMaxReservedBytes,
    extractionAdaptiveConcurrency: boolean("EXTRACTION_ADAPTIVE_CONCURRENCY", true),
    localCpuLimitRatio: ratio("LOCAL_CPU_LIMIT_RATIO", 0.85),
    localMemoryLimitRatio, modelPreparationMaxBytes,
    memoryPressureLargeSubmissionBytes: integer("MEMORY_PRESSURE_LARGE_SUBMISSION_BYTES", 4 * 1024 * 1024),
    localDiskReserveBytes: integer("LOCAL_DISK_RESERVE_BYTES", 1024 * 1024 * 1024, 0),
    sourceRetentionSweepIntervalMs: integer("SOURCE_RETENTION_SWEEP_INTERVAL_MS", 3600000, 1, 2147483647),
    failedSourceRetentionMs: integer("FAILED_SOURCE_RETENTION_MS", 604800000, 0, 8640000000000000),
    shutdownTimeoutMs: integer("LOCAL_SHUTDOWN_TIMEOUT_MS", 10000, 1, 2147483647),
    modelGatewayRequestTimeoutMs: integer("MODEL_GATEWAY_REQUEST_TIMEOUT_MS", 300000, 1, 2147483647),
    analyticsEnabled: boolean("LOCAL_ANALYTICS_ENABLED", true),
    sourceStorage,
    auth: {
      baseURL: text("BETTER_AUTH_URL") ? origin(text("BETTER_AUTH_URL")!, "BETTER_AUTH_URL") : undefined,
      adminEmails: list("DOCUMENT_EXTRACTION_ADMIN_EMAILS").map((email) => emailAddress(email, "DOCUMENT_EXTRACTION_ADMIN_EMAILS").toLowerCase()),
      trustedOrigins: list("AUTH_TRUSTED_ORIGINS").map((item) => origin(item, "AUTH_TRUSTED_ORIGINS")),
      trustedIpHeaders,
      emailPasswordEnabled, googleEnabled, googleClientId, googleClientSecret,
      signupEnabled: boolean("AUTH_SIGNUP_ENABLED", true),
      requireEmailVerification: boolean("AUTH_REQUIRE_EMAIL_VERIFICATION", false),
    },
    email,
  };
}

export type LocalConfiguration = ReturnType<typeof readLocalConfiguration>;

/**
 * Source file retention is distinct from processing cleanup: FAILED_SOURCE_RETENTION_MS and
 * SOURCE_RETENTION_SWEEP_INTERVAL_MS govern processing files whose originals are not retained.
 */
function readSourceStorageConfiguration(
  text: (name: string) => string | undefined,
  boolean: (name: string, fallback: boolean) => boolean,
  secret: (name: string) => string | undefined,
): LocalSourceStorageConfiguration {
  const provider = text("SOURCE_STORAGE_PROVIDER")?.toLowerCase() ?? "none";
  if (provider !== "none" && provider !== "local" && provider !== "s3") throw new Error("SOURCE_STORAGE_PROVIDER must be none, local or s3.");
  // Selecting a store enables retention by default; installations without one never retain.
  const originalRetentionEnabled = boolean("SOURCE_ORIGINAL_RETENTION_ENABLED", provider !== "none");
  if (originalRetentionEnabled && provider === "none") {
    throw new Error("SOURCE_ORIGINAL_RETENTION_ENABLED requires SOURCE_STORAGE_PROVIDER to be local or s3.");
  }
  if (provider !== "s3") return { provider, originalRetentionEnabled };

  const bucket = text("SOURCE_STORAGE_S3_BUCKET");
  const region = text("SOURCE_STORAGE_S3_REGION");
  const accessKeyId = secret("SOURCE_STORAGE_S3_ACCESS_KEY_ID");
  const secretAccessKey = secret("SOURCE_STORAGE_S3_SECRET_ACCESS_KEY");
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("SOURCE_STORAGE_PROVIDER=s3 requires SOURCE_STORAGE_S3_BUCKET, SOURCE_STORAGE_S3_REGION, SOURCE_STORAGE_S3_ACCESS_KEY_ID and SOURCE_STORAGE_S3_SECRET_ACCESS_KEY.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("SOURCE_STORAGE_S3_BUCKET must be a valid S3 bucket name.");
  if (!/^[a-z0-9-]{1,64}$/.test(region)) throw new Error("SOURCE_STORAGE_S3_REGION must be an S3 region name such as eu-west-2.");
  const rawEndpoint = text("SOURCE_STORAGE_S3_ENDPOINT");
  let endpoint: string | undefined;
  if (rawEndpoint) {
    try {
      const url = new URL(rawEndpoint);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
      endpoint = url.origin;
    } catch { throw new Error("SOURCE_STORAGE_S3_ENDPOINT must be an HTTP(S) origin without credentials, a path or a query."); }
  }
  const prefix = text("SOURCE_STORAGE_S3_PREFIX") ?? "document-extraction/";
  if (!/^(?:[A-Za-z0-9!_.*'()-]+\/)+$/.test(prefix) || prefix.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("SOURCE_STORAGE_S3_PREFIX must be one or more safe path segments ending in \"/\".");
  }
  return {
    provider,
    originalRetentionEnabled,
    s3: {
      bucket, region, endpoint, prefix, accessKeyId, secretAccessKey,
      forcePathStyle: boolean("SOURCE_STORAGE_S3_FORCE_PATH_STYLE", Boolean(endpoint)),
      sessionToken: secret("SOURCE_STORAGE_S3_SESSION_TOKEN"),
    },
  };
}

export function readLocalMemoryLimits(env: { LOCAL_MEMORY_LIMIT_RATIO?: string; MODEL_PREPARATION_MAX_BYTES?: string }, totalMemoryBytes: number) {
  if (!Number.isSafeInteger(totalMemoryBytes) || totalMemoryBytes < 1) throw new Error("System memory must be a positive integer byte count.");
  const memoryLimitRatio = Number(env.LOCAL_MEMORY_LIMIT_RATIO?.trim() || 0.8);
  if (!Number.isFinite(memoryLimitRatio) || memoryLimitRatio <= 0 || memoryLimitRatio > 1) throw new Error("LOCAL_MEMORY_LIMIT_RATIO must be greater than zero and no greater than one.");
  const processLimitBytes = Math.floor(totalMemoryBytes * memoryLimitRatio);
  // Keep preparation below the RSS threshold, leaving 10% for uploads and runtime overhead.
  const defaultPreparationBytes = Math.floor(processLimitBytes * 0.9);
  const raw = env.MODEL_PREPARATION_MAX_BYTES?.trim();
  const preparationMaxBytes = raw ? Number(raw) : defaultPreparationBytes;
  if ((raw && !/^\d+$/.test(raw)) || !Number.isSafeInteger(preparationMaxBytes) || preparationMaxBytes < 1 || preparationMaxBytes > defaultPreparationBytes) {
    throw new Error(`MODEL_PREPARATION_MAX_BYTES must be a positive integer no greater than ${defaultPreparationBytes}.`);
  }
  return { totalMemoryBytes, memoryLimitRatio, processLimitBytes, preparationMaxBytes };
}

/** The origin a browser on this machine uses to reach a listener bound to `host`. */
export function localBrowserOrigin(host: string, port: number): string {
  const browserHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "[::1]" : host.includes(":") ? `[${host}]` : host;
  return `http://${browserHost}:${port}`;
}

export function publicLocalConfiguration(configuration: LocalConfiguration) {
  const { emailPasswordEnabled, googleEnabled, signupEnabled, requireEmailVerification } = configuration.auth;
  return {
    auth: { emailPasswordEnabled, googleEnabled, signupEnabled, requireEmailVerification, mailDelivery: configuration.email.provider },
    limits: { maxSourceFileBytes: configuration.maxSourceFileBytes },
    sourceStorage: {
      configured: configuration.sourceStorage.provider !== "none",
      retainsOriginals: configuration.sourceStorage.originalRetentionEnabled,
    },
  };
}
