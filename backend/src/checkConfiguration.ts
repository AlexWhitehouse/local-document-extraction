import { readLocalConfiguration } from "./localConfiguration";

try {
  readLocalConfiguration();
  console.info("Configuration is valid.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuration is invalid.");
  process.exitCode = 1;
}
