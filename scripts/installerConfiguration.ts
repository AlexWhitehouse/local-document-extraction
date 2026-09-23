import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { readLocalConfiguration } from "../backend/src/localConfiguration";

export type SetupPrompt = {
  ask(question: string, secret?: boolean): Promise<string>;
  say(message: string): void;
};

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

export function shouldPromptForConfiguration(mode = "auto", terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY)) {
  if (!["auto", "interactive", "non-interactive"].includes(mode)) throw new Error("Invalid installer setup mode.");
  if (mode === "interactive" && !terminal) throw new Error("Interactive setup requires a terminal. Run the installer directly, or use --non-interactive with a prepared config.env.");
  return mode !== "non-interactive" && terminal;
}

/** Nothing is persisted until every answer has been collected and validated. */
export async function collectInstallerConfiguration(prompt: SetupPrompt, localOrigin = "http://127.0.0.1:8787") {
  const settings: Record<string, string> = {
    AUTH_GOOGLE_ENABLED: "false", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    AUTH_EMAIL_PASSWORD_ENABLED: "true", AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    EMAIL_PROVIDER: "local", CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_EMAIL_API_TOKEN: "",
    EMAIL_FROM_ADDRESS: "no-reply@example.com", EMAIL_FROM_NAME: "Document Extraction",
  };
  async function yesNo(question: string, fallback = false) {
    while (true) {
      const answer = (await prompt.ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`)).trim().toLowerCase();
      if (!answer) return fallback;
      if (["y", "yes"].includes(answer)) return true;
      if (["n", "no"].includes(answer)) return false;
      prompt.say("Please answer yes or no.");
    }
  }
  async function value(question: string, validate: (answer: string) => string, secret = false, fallback = "") {
    while (true) {
      const answer = (await prompt.ask(`${question}${fallback ? ` [${fallback}]` : ""}`, secret)).trim() || fallback;
      try {
        if (!answer || hasControlCharacters(answer)) throw new Error("Enter a non-empty, single-line value.");
        dotenvValue(answer);
        return validate(answer);
      } catch (error) {
        // Validators report requirements only, never the supplied credential.
        prompt.say(error instanceof Error ? error.message : "Invalid value. Please try again.");
      }
    }
  }
  const identity = (answer: string) => answer;
  prompt.say("\nFirst-time setup. Press Enter to use the defaults. Ctrl+C cancels without saving answers.");
  const behindProxy = await yesNo("Will this app run behind a reverse proxy?");
  if (behindProxy) {
    settings.BETTER_AUTH_URL = await value("Public app URL (for example https://documents.example.com)", (answer) =>
      readLocalConfiguration({ environment: { BETTER_AUTH_URL: answer } }).auth.baseURL!);
    prompt.say(`Point your proxy at ${localOrigin}, including /api/auth, /v1 and WebSocket connections.`);
    prompt.say("The listener stays on loopback. Proxy IP headers are not automatically trusted.");
  }
  const browserOrigin = settings.BETTER_AUTH_URL || localOrigin;
  if (await yesNo("Enable Google sign-in?")) {
    prompt.say("Create a Web application OAuth client: https://console.cloud.google.com/apis/credentials");
    prompt.say(`Authorized redirect URI: ${browserOrigin}/api/auth/callback/google`);
    settings.GOOGLE_CLIENT_ID = await value("Google client ID", identity);
    settings.GOOGLE_CLIENT_SECRET = await value("Google client secret (hidden)", identity, true);
    settings.AUTH_GOOGLE_ENABLED = "true";
    settings.AUTH_EMAIL_PASSWORD_ENABLED = String(await yesNo("Also enable email and password login?", true));
  }
  if (await yesNo("Send account emails with Cloudflare?")) {
    prompt.say("First enable Email Sending for your sender domain: https://developers.cloudflare.com/email-service/get-started/send-emails/");
    prompt.say("Find your account ID: https://dash.cloudflare.com/ — select your account, then search for Copy account ID.");
    settings.CLOUDFLARE_ACCOUNT_ID = await value("Cloudflare account ID", (answer) => {
      if (!/^[a-fA-F0-9]{32}$/.test(answer)) throw new Error("Account ID must contain 32 hexadecimal characters.");
      return answer;
    });
    prompt.say("Create a custom API token: https://dash.cloudflare.com/profile/api-tokens");
    prompt.say("Grant Account > Email Sending > Edit, restricted to the account above. Use the API token, not the Global API key.");
    settings.CLOUDFLARE_EMAIL_API_TOKEN = await value("Cloudflare Email API token (hidden)", identity, true);
    settings.EMAIL_FROM_ADDRESS = await value("From email address (on your onboarded domain)", (answer) =>
      readLocalConfiguration({ environment: { EMAIL_FROM_ADDRESS: answer } }).email.fromAddress);
    settings.EMAIL_FROM_NAME = await value("From name", (answer) =>
      readLocalConfiguration({ environment: { EMAIL_FROM_NAME: answer } }).email.fromName, false, "Document Extraction");
    settings.EMAIL_PROVIDER = "cloudflare";
    if (settings.AUTH_EMAIL_PASSWORD_ENABLED === "true") {
      settings.AUTH_REQUIRE_EMAIL_VERIFICATION = String(await yesNo("Require email verification when signing up with email and password?", true));
    }
    prompt.say("Cloudflare delivery is configured; credentials and domain readiness are checked when sending, not during installation.");
  } else {
    prompt.say("Account emails stay in the private local mail log. Signup email verification is off.");
  }
  readLocalConfiguration({ environment: settings });
  prompt.say(`\nSetup complete: Google ${settings.AUTH_GOOGLE_ENABLED === "true" ? "on" : "off"}, email/password ${settings.AUTH_EMAIL_PASSWORD_ENABLED === "true" ? "on" : "off"}, email delivery ${settings.EMAIL_PROVIDER}, signup verification ${settings.AUTH_REQUIRE_EMAIL_VERIFICATION === "true" ? "on" : "off"}.`);
  return settings;
}

/** Serialize for Bun's dotenv loader, not a shell: values must never expand $VAR. */
function dotenvValue(value: string) {
  // Bun preserves backslashes (except dollar escapes) in single/backtick quotes.
  // JSON escaping would silently change credentials containing quotes or slashes.
  const quote = ["'", "`", '"'].find((candidate) => !value.includes(candidate)
    && !(candidate === '"' && /\\[nr]/.test(value)));
  const escaped = value.replace(/\$/g, "\\$");
  const trailingSlashes = value.match(/\\+$/)?.[0].length ?? 0;
  if (quote && trailingSlashes % 2 === 0) return `${quote}${escaped}${quote}`;
  if (value && !/^["'`]|#/.test(value) && value === value.trim()) return escaped;
  throw new Error("This combination of quotes, backslashes and # cannot be saved safely in config.env. Use a value without that combination.");
}

export function renderInstallerConfiguration(example: string, settings: Record<string, string>) {
  let contents = example;
  for (const [key, value] of Object.entries(settings)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || hasControlCharacters(value)) throw new Error("Invalid installer configuration value.");
    const line = `${key}=${dotenvValue(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  return contents;
}

/** Readline keeps terminal echo disabled; the output filter also hides secrets. */
export function createSetupTerminal(): SetupPrompt & { close(): void } {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Setup requires a terminal.");
  let hidden = false;
  let closed = false;
  let rejectPending: ((error: Error) => void) | undefined;
  const output = new Writable({ write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  terminal.on("SIGINT", () => terminal.close());
  terminal.on("close", () => {
    closed = true;
    hidden = false;
    rejectPending?.(new Error("Setup cancelled. No answers were saved."));
  });
  return {
    say: (message) => process.stdout.write(`${message}\n`),
    ask: (question, secret = false) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Setup cancelled. No answers were saved.")); return; }
      rejectPending = reject;
      process.stdout.write(`${question}: `);
      hidden = secret;
      terminal.question("", (answer) => {
        rejectPending = undefined;
        hidden = false;
        if (secret) process.stdout.write("\n");
        resolve(answer);
      });
    }),
    close: () => terminal.close(),
  };
}
