import { createLocalAuthRuntime } from "./localAuthRuntime";
import { localBrowserOrigin, readLocalConfiguration } from "./localConfiguration";
import { retireGlobalModelConfiguration } from "./retireGlobalModelConfiguration";
import { ensureLocalStateDirectories } from "./localRuntime";

const configuration = readLocalConfiguration();
const { stateDirectory } = configuration;
await ensureLocalStateDirectories(stateDirectory);
const runtime = await createLocalAuthRuntime({
  ...configuration.auth,
  // Migration does not bind a listener; ephemeral ports resolve at server startup.
  baseURL: configuration.auth.baseURL || localBrowserOrigin(configuration.host, configuration.port),
  email: configuration.email,
  stateDirectory,
});
runtime.close();
await retireGlobalModelConfiguration(stateDirectory);
console.info(`Local state is initialized at ${stateDirectory}`);
