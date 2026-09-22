import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Database, constants as sqliteConstants } from "bun:sqlite";

import { createLocalAuth, type LocalAuth, type LocalAuthSettings } from "./localAuth";
import { createLocalMailSink, type LocalMailLogger } from "./localMailSink";
import { createLocalWorkspaceControl, type LocalWorkspaceControl } from "./localWorkspaceControl";
import { createCloudflareMailSink } from "./cloudflareMailSink";
import type { LocalEmailConfiguration } from "./localConfiguration";
import { ensureLocalStateDirectories } from "./localRuntime";
import { assertRegularStateFile } from "./localStatePaths";

export type LocalAuthRuntime = {
  auth: LocalAuth;
  close(): void;
  workspaceControl: LocalWorkspaceControl;
};

export async function createLocalAuthRuntime({
  adminEmails,
  baseURL,
  googleClientId,
  googleClientSecret,
  logger = console,
  stateDirectory,
  email = { provider: "local", fromAddress: "no-reply@example.com", fromName: "Document Extraction" },
  ...settings
}: LocalAuthSettings & {
  adminEmails?: string[];
  baseURL: string;
  googleClientId?: string;
  googleClientSecret?: string;
  logger?: LocalMailLogger & { error(message: string, error: unknown): void };
  stateDirectory: string;
  email?: LocalEmailConfiguration;
}): Promise<LocalAuthRuntime> {
  const mailDirectory = join(stateDirectory, "mail");
  await ensureLocalStateDirectories(stateDirectory);
  // SQLite NOFOLLOW checks the entire path; resolve legitimate OS aliases only
  // after the owned state directories have been checked for symbolic links.
  const dataDirectory = await realpath(join(stateDirectory, "data"));

  const databasePath = join(dataDirectory, "control.sqlite");
  const secretPath = join(dataDirectory, "better-auth-secret");
  for (const path of [secretPath, databasePath, ...["-journal", "-wal", "-shm"].map((suffix) => databasePath + suffix)]) {
    await assertRegularStateFile(path);
  }
  const databaseFile = await open(databasePath, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW, 0o600);
  try { await databaseFile.chmod(0o600); }
  finally { await databaseFile.close(); }
  const database = new Database(databasePath, sqliteConstants.SQLITE_OPEN_READWRITE | sqliteConstants.SQLITE_OPEN_CREATE | sqliteConstants.SQLITE_OPEN_NOFOLLOW);
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    const auth = await createLocalAuth({
      ...settings,
      adminEmails,
      baseURL,
      database,
      googleClientId,
      googleClientSecret,
      logger,
      emailFrom: { email: email.fromAddress, name: email.fromName },
      mailSink: email.provider === "cloudflare"
        ? createCloudflareMailSink({ accountId: email.cloudflareAccountId ?? "", apiToken: email.cloudflareApiToken ?? "" })
        : createLocalMailSink({ directory: mailDirectory, logger }),
      secret: await readOrCreateSecret(secretPath),
    });

    return {
      auth,
      close: () => database.close(),
      workspaceControl: createLocalWorkspaceControl(database),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

async function readOrCreateSecret(path: string): Promise<string> {
  await assertRegularStateFile(path);
  try {
    const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const existing = (await file.readFile("utf8")).trim();
      if (!existing) throw new Error("Stored authentication secret is empty.");
      await file.chmod(0o600);
      return existing;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const secret = randomBytes(32).toString("base64url");
  try {
    const file = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(`${secret}\n`, "utf8"); }
    finally { await file.close(); }
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }

    return readOrCreateSecret(path);
  }
}
