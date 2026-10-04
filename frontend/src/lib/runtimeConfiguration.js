import { isBoolean } from "../../../shared/json.ts";

// Source file types the backend accepts for extraction.
export const SOURCE_FILE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export const DEFAULT_RUNTIME_CONFIGURATION = Object.freeze({
  auth: Object.freeze({
    emailPasswordEnabled: true,
    googleEnabled: false,
    signupEnabled: true,
    requireEmailVerification: false,
    mailDelivery: "local",
  }),
  limits: Object.freeze({ maxSourceFileBytes: 10 * 1024 * 1024 }),
  sourceStorage: Object.freeze({ configured: false, retainsOriginals: false }),
});

export async function fetchRuntimeConfiguration(signal) {
  const response = await fetch("/v1/config", { cache: "no-store", signal });

  if (!response.ok) throw new Error("Application configuration is unavailable.");
  const configuration = await response.json();
  const auth = configuration?.auth;

  if (
    !auth ||
    ["emailPasswordEnabled", "googleEnabled", "signupEnabled", "requireEmailVerification"].some(
      (key) => !isBoolean(auth[key]),
    ) ||
    !["local", "cloudflare"].includes(auth.mailDelivery) ||
    !Number.isSafeInteger(configuration?.limits?.maxSourceFileBytes) ||
    configuration.limits.maxSourceFileBytes < 1
  ) {
    throw new Error("Application configuration is invalid. Check that the server and frontend versions match.");
  }

  // Older servers omit Source storage; treat that as no installation storage.
  const sourceStorage = configuration.sourceStorage;

  return {
    ...configuration,
    sourceStorage: {
      configured: sourceStorage?.configured === true,
      retainsOriginals: sourceStorage?.retainsOriginals === true,
    },
  };
}
