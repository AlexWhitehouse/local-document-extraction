import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalAuth, type LocalAuth } from "./localAuth";
import { createLocalMailSink, type LocalMailLogger } from "./localMailSink";
import { createLocalWorkspaceControl, type LocalWorkspaceControl } from "./localWorkspaceControl";

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
}: {
  adminEmails?: string[];
  baseURL: string;
  googleClientId?: string;
  googleClientSecret?: string;
  logger?: LocalMailLogger & { error(message: string, error: unknown): void };
  stateDirectory: string;
}): Promise<LocalAuthRuntime> {
  const dataDirectory = join(stateDirectory, "data");
  const mailDirectory = join(stateDirectory, "mail");
  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    mkdir(mailDirectory, { recursive: true }),
  ]);

  const database = new Database(join(dataDirectory, "control.sqlite"));
  database.exec("PRAGMA foreign_keys = ON;");
  const auth = await createLocalAuth({
    adminEmails,
    baseURL,
    database,
    googleClientId,
    googleClientSecret,
    logger,
    mailSink: createLocalMailSink({ directory: mailDirectory, logger }),
    secret: await readOrCreateSecret(join(dataDirectory, "better-auth-secret")),
  });

  return {
    auth,
    close: () => database.close(),
    workspaceControl: createLocalWorkspaceControl(database),
  };
}

async function readOrCreateSecret(path: string): Promise<string> {
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.trim()) {
    return existing.trim();
  }

  const secret = randomBytes(32).toString("base64url");
  try {
    await writeFile(path, `${secret}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }

    return (await readFile(path, "utf8")).trim();
  }
}
