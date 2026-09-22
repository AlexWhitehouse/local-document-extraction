import { createLocalAuthRuntime } from "./localAuthRuntime";
import { readLocalConfiguration } from "./localConfiguration";
import { retireGlobalModelConfiguration } from "./retireGlobalModelConfiguration";
import { ensureLocalStateDirectories } from "./localRuntime";

const configuration = readLocalConfiguration();
const { stateDirectory } = configuration;
// Migration does not bind a listener; ephemeral ports resolve at server startup.
const host = configuration.host === "0.0.0.0" ? "127.0.0.1" : configuration.host === "::" ? "[::1]" : configuration.host.includes(":") ? `[${configuration.host}]` : configuration.host;
await ensureLocalStateDirectories(stateDirectory);
const runtime = await createLocalAuthRuntime({
  ...configuration.auth,
  baseURL: configuration.auth.baseURL || `http://${host}:${configuration.port}`,
  email: configuration.email,
  stateDirectory,
});
runtime.close();
await retireGlobalModelConfiguration(stateDirectory);
console.info(`Local state is initialized at ${stateDirectory}`);
