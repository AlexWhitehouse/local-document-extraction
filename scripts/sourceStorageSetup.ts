import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { readLocalConfiguration, type S3SourceStorageConfiguration } from "../backend/src/localConfiguration";
import { createS3SourceObjectStore, sourceObjectDestination } from "../backend/src/s3SourceObjectStore";
import { createSetupTerminal, dotenvValue, renderInstallerConfiguration, setupQuestions, type SetupPrompt } from "./installerConfiguration";
import { writePrivateFile, type Installation } from "./manageInstallation";

const S3_KEYS = [
  "SOURCE_STORAGE_S3_ENDPOINT", "SOURCE_STORAGE_S3_REGION", "SOURCE_STORAGE_S3_BUCKET", "SOURCE_STORAGE_S3_PREFIX",
  "SOURCE_STORAGE_S3_FORCE_PATH_STYLE", "SOURCE_STORAGE_S3_ACCESS_KEY_ID", "SOURCE_STORAGE_S3_SECRET_ACCESS_KEY",
  "SOURCE_STORAGE_S3_SESSION_TOKEN",
] as const;

export const BUCKET_REQUIREMENT_NOTICE = [
  "This bucket must not use object versioning or Object Lock. Document Extraction does not check this.",
  "On a versioned or locked bucket, deleting a Document or Workspace leaves earlier copies of the original in storage.",
];

export type SourceStorageProbe = (configuration: S3SourceStorageConfiguration) => Promise<void>;

export type SourceStorageSetupOptions = {
  /** Current config.env values; empty for a first installation. */
  current?: Record<string, string>;
  probe: SourceStorageProbe;
  /** A recorded S3 destination that retained originals or unfinished cleanup still depend on. */
  dependentDestination?: string | null;
  /** Reconfiguration offers turning retention off for new uploads; first installs retain by default. */
  askRetention?: boolean;
  /** Scripted setup states the bucket requirement explicitly instead of answering the prompt. */
  confirmUnversionedBucket?: boolean;
};

/** Collects and validates Source storage settings. Nothing is saved when this throws. */
export async function collectSourceStorageSettings(prompt: SetupPrompt, {
  current = {},
  probe,
  dependentDestination = null,
  askRetention = false,
  confirmUnversionedBucket = false,
}: SourceStorageSetupOptions): Promise<Record<string, string>> {
  const { yesNo, value } = setupQuestions(prompt);
  const currentProvider = current.SOURCE_STORAGE_PROVIDER?.trim().toLowerCase() || "none";
  const currentS3 = currentProvider === "s3" ? readStorage(current).s3 : undefined;
  prompt.say("\nOriginal documents: none keeps only extraction results; local keeps originals in the private state directory; s3 keeps them in an S3-compatible bucket.");
  const provider = await value("Keep original documents? (none, local or s3)", (answer) => {
    const normalized = answer.toLowerCase();
    if (!["none", "local", "s3"].includes(normalized)) throw new Error("Answer none, local or s3.");
    return normalized;
  }, false, currentProvider);

  const settings: Record<string, string> = { SOURCE_STORAGE_PROVIDER: provider };
  if (provider !== "s3") {
    if (dependentDestination) throw dependentDestinationError();
    for (const key of S3_KEYS) settings[key] = "";
  } else {
    const optional = async (question: string, fallback: string) =>
      (await prompt.ask(`${question}${fallback ? ` [${fallback}]` : ""}`)).trim() || fallback;
    const endpoint = await optional("S3 endpoint URL (Enter for AWS S3, e.g. http://rustfs.internal:9000)", current.SOURCE_STORAGE_S3_ENDPOINT ?? "");
    settings.SOURCE_STORAGE_S3_ENDPOINT = endpoint;
    settings.SOURCE_STORAGE_S3_REGION = await value("Region", identity, false, current.SOURCE_STORAGE_S3_REGION || "us-east-1");
    settings.SOURCE_STORAGE_S3_BUCKET = await value("Bucket", identity, false, current.SOURCE_STORAGE_S3_BUCKET ?? "");
    settings.SOURCE_STORAGE_S3_PREFIX = await value("Object key prefix", identity, false, current.SOURCE_STORAGE_S3_PREFIX || "document-extraction/");
    const pathStyleDefault = current.SOURCE_STORAGE_S3_FORCE_PATH_STYLE ? current.SOURCE_STORAGE_S3_FORCE_PATH_STYLE === "true" : Boolean(endpoint);
    settings.SOURCE_STORAGE_S3_FORCE_PATH_STYLE = String(await yesNo("Use path-style addressing? (usual for RustFS and other self-hosted endpoints)", pathStyleDefault));
    settings.SOURCE_STORAGE_S3_ACCESS_KEY_ID = await keepOrReplace("Access key ID", current.SOURCE_STORAGE_S3_ACCESS_KEY_ID, false);
    settings.SOURCE_STORAGE_S3_SECRET_ACCESS_KEY = await keepOrReplace("Secret access key (hidden)", current.SOURCE_STORAGE_S3_SECRET_ACCESS_KEY, true);
    settings.SOURCE_STORAGE_S3_SESSION_TOKEN = await optionalSecret("Session token for temporary credentials (hidden, optional)", current.SOURCE_STORAGE_S3_SESSION_TOKEN);

    const s3 = readStorage({ ...settings, SOURCE_ORIGINAL_RETENTION_ENABLED: "true" }).s3!;
    const destination = sourceObjectDestination(s3);
    if (dependentDestination && dependentDestination !== destination) throw dependentDestinationError();
    const destinationChanged = !currentS3 || sourceObjectDestination(currentS3) !== destination;
    const credentialsChanged = !currentS3 || currentS3.accessKeyId !== s3.accessKeyId
      || currentS3.secretAccessKey !== s3.secretAccessKey || currentS3.sessionToken !== s3.sessionToken;
    if (destinationChanged) {
      for (const line of BUCKET_REQUIREMENT_NOTICE) prompt.say(line);
      if (!confirmUnversionedBucket && !await yesNo("Confirm this bucket meets the requirement?", false)) {
        throw new Error("Storage settings unchanged: the bucket requirement was not confirmed.");
      }
    }
    if (destinationChanged || credentialsChanged) {
      prompt.say("Checking the bucket with a temporary test object…");
      try {
        await probe(s3);
      } catch (error) {
        throw new Error(`Storage settings unchanged: ${error instanceof Error ? error.message : "the storage check failed"}.`, { cause: error });
      }
      prompt.say("Storage check passed: a test object was written, read back and deleted.");
    }
  }

  const retentionDefault = current.SOURCE_ORIGINAL_RETENTION_ENABLED ? current.SOURCE_ORIGINAL_RETENTION_ENABLED === "true" : true;
  settings.SOURCE_ORIGINAL_RETENTION_ENABLED = provider === "none"
    ? "false"
    : String(askRetention ? await yesNo("Retain originals of new uploads? (existing originals stay available either way)", retentionDefault) : true);
  readStorage(settings);
  return settings;

  async function optionalSecret(question: string, existing: string | undefined) {
    while (true) {
      // Enter keeps an existing token (never echoed); "-" clears it.
      const answer = (await prompt.ask(`${question}${existing ? " (Enter keeps the current value, - removes it)" : " (Enter for none)"}`, true)).trim();
      if (!answer) return existing ?? "";
      if (answer === "-") return "";
      try {
        dotenvValue(answer);
        return answer;
      } catch (error) {
        prompt.say(error instanceof Error ? error.message : "Invalid value. Please try again.");
      }
    }
  }

  async function keepOrReplace(question: string, existing: string | undefined, secret: boolean) {
    while (true) {
      // Never echo an existing credential; Enter keeps it.
      const answer = (await prompt.ask(`${question}${existing ? " (Enter keeps the current value)" : ""}`, secret)).trim();
      if (!answer && existing) return existing;
      try {
        if (!answer) throw new Error("Enter a value.");
        dotenvValue(answer);
        return answer;
      } catch (error) {
        prompt.say(error instanceof Error ? error.message : "Invalid value. Please try again.");
      }
    }
  }
}

function identity(answer: string) {
  return answer;
}

function readStorage(values: Record<string, string>) {
  return readLocalConfiguration({ environment: values }).sourceStorage;
}

function dependentDestinationError() {
  return new Error(
    "Storage settings unchanged: retained originals or unfinished cleanup still depend on the current S3 endpoint, bucket, prefix and addressing style. "
    + "Moving originals is not supported; keep that destination (credentials may be rotated), or turn off retention for new uploads instead.",
  );
}

/** Writes, reads back and deletes a small synthetic object under the configured prefix. */
export const probeS3SourceStorage: SourceStorageProbe = async (configuration) => {
  const store = createS3SourceObjectStore(configuration, { writeDeadlineMs: 15_000, readDeadlineMs: 15_000 });
  const key = `${configuration.prefix}.setup-probe/${crypto.randomUUID()}.txt`;
  const body = `document-extraction storage check ${new Date().toISOString()}`;
  const stage = async <T,>(label: string, work: () => Promise<T>) => {
    try { return await work(); } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      throw new Error(`could not ${label}${code ? ` (${code})` : ""}`, { cause: error });
    }
  };
  try {
    await stage("write a test object", () => store.put({ key, file: new Blob([body], { type: "text/plain" }), mimeType: "text/plain" }));
  } catch (error) {
    // A timed-out write cannot be cancelled and may still land, so try to remove it and name it.
    await store.delete(key).catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : "could not write a test object"}; if ${key} appears in the bucket later, delete it`, { cause: error });
  }
  try {
    const object = await stage("read the test object back", () => store.open(key));
    const text = await stage("read the test object back", () => new Response(object.stream()).text());
    if (text !== body) throw new Error("the test object read back did not match");
  } finally {
    await stage(`delete the test object ${key}`, () => store.delete(key));
  }
};

/** Reads values written by the installer's dotenv serializer (quoted or bare, with escaped dollars). */
export function parseConfigurationValues(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2]!;
    const quote = value[0];
    if (quote && ["'", "`", '"'].includes(quote) && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
    values[match[1]!] = value.replace(/\\\$/g, "$");
  }
  return values;
}

/** The S3 destination that retained originals or unfinished cleanup still depend on, if any. */
export function dependentSourceDestination(stateDirectory: string): string | null {
  const path = join(stateDirectory, "data", "control.sqlite");
  let database: Database;
  try { database = new Database(path, { readonly: true }); } catch { return null; }
  try {
    const tables = new Set((database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
    if (!tables.has("source_object_manifest") || !tables.has("source_storage_installation")) return null;
    const { count } = database.query("SELECT COUNT(*) AS count FROM source_object_manifest").get() as { count: number };
    if (!count) return null;
    return (database.query("SELECT destination FROM source_storage_installation WHERE singleton = 1").get() as { destination: string | null } | null)?.destination ?? null;
  } finally { database.close(); }
}

export async function configureSourceStorage(installation: Installation, {
  prompt,
  probe = probeS3SourceStorage,
  confirmUnversionedBucket = false,
}: { prompt: SetupPrompt; probe?: SourceStorageProbe; confirmUnversionedBucket?: boolean }) {
  const contents = await readFile(installation.configFile, "utf8");
  const settings = await collectSourceStorageSettings(prompt, {
    current: parseConfigurationValues(contents),
    probe,
    dependentDestination: dependentSourceDestination(installation.state),
    askRetention: true,
    confirmUnversionedBucket,
  });
  await writePrivateFile(installation.configFile, renderInstallerConfiguration(contents, settings));
  const overrides = Object.keys(settings).filter((key) => process.env[key] !== undefined);
  if (overrides.length) prompt.say(`Process environment variables override these saved settings: ${overrides.join(", ")}. Unset them to use config.env.`);
  prompt.say("Storage settings saved. Start the application to apply them: document-extraction start");
}

// Invoked by `document-extraction storage configure`, which holds the management lock and has
// already confirmed the application is stopped.
if (import.meta.main) {
  try {
    const [rootArgument, ...flags] = process.argv.slice(2);
    if (!rootArgument) throw new Error("Use: document-extraction storage configure");
    const installation = JSON.parse(await readFile(join(resolve(rootArgument), "installation.json"), "utf8")) as Installation;
    const terminal = createSetupTerminal();
    try {
      await configureSourceStorage(installation, { prompt: terminal, confirmUnversionedBucket: flags.includes("--confirm-unversioned-bucket") });
    } finally { terminal.close(); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
