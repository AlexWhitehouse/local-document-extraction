import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalAuthRuntime } from "./localAuthRuntime";
import { ensureLocalStateDirectories } from "./localRuntime";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateDirectory = process.env.DOCUMENT_EXTRACTION_STATE_DIR || resolve(repositoryRoot, ".local");
const baseURL = process.env.BETTER_AUTH_URL || `http://127.0.0.1:${readPort(process.env.PORT)}`;

await ensureLocalStateDirectories(stateDirectory);
const runtime = await createLocalAuthRuntime({
  adminEmails: (process.env.DOCUMENT_EXTRACTION_ADMIN_EMAILS || "").split(","),
  baseURL,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  stateDirectory,
});
runtime.close();
console.info(`Local state is initialized at ${stateDirectory}`);

function readPort(value: string | undefined): number {
  const parsed = Number(value || 8787);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 8787;
}
