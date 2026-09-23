import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inTerminal } from "./installerTestSupport";
import { collectInstallerConfiguration, renderInstallerConfiguration, shouldPromptForConfiguration } from "./installerConfiguration";

function answers(responses: string[]) {
  const questions: { question: string; secret: boolean }[] = [];
  const messages: string[] = [];
  return {
    questions, messages,
    prompt: {
      async ask(question: string, secret = false) {
        questions.push({ question, secret });
        const response = responses.shift();
        if (response === undefined) throw new Error(`Unexpected question: ${question}`);
        return response;
      },
      say(message: string) { messages.push(message); },
    },
  };
}

describe("first-install configuration", () => {
  test("local defaults ask only three questions and keep email login usable", async () => {
    const fixture = answers(["", "", ""]);
    expect(await collectInstallerConfiguration(fixture.prompt)).toMatchObject({
      AUTH_GOOGLE_ENABLED: "false", AUTH_EMAIL_PASSWORD_ENABLED: "true",
      EMAIL_PROVIDER: "local", AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    });
    expect(fixture.questions).toHaveLength(3);
  });

  test("configures the public origin, Google, Cloudflare and optional verification", async () => {
    const fixture = answers(["yes", "https://docs.example.com/", "y", "test-client", "test-google-secret", "", "y", "a".repeat(32), "test-email-token", "sender@example.com", "Example App", ""]);
    expect(await collectInstallerConfiguration(fixture.prompt)).toMatchObject({
      BETTER_AUTH_URL: "https://docs.example.com", AUTH_GOOGLE_ENABLED: "true", GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-google-secret", AUTH_EMAIL_PASSWORD_ENABLED: "true", EMAIL_PROVIDER: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
      EMAIL_FROM_ADDRESS: "sender@example.com", EMAIL_FROM_NAME: "Example App", AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
    });
    expect(fixture.questions.filter((q) => q.secret).map((q) => q.question)).toEqual(["Google client secret (hidden)", "Cloudflare Email API token (hidden)"]);
    expect(fixture.messages.join("\n")).toContain("https://docs.example.com/api/auth/callback/google");
    expect(fixture.messages.join("\n")).not.toContain("test-google-secret");
    expect(fixture.messages.join("\n")).not.toContain("test-email-token");
  });

  test("Google-only access skips signup verification even with Cloudflare", async () => {
    const fixture = answers(["n", "y", "test-client", "test-secret", "n", "y", "b".repeat(32), "test-token", "sender@example.com", ""]);
    expect(await collectInstallerConfiguration(fixture.prompt)).toMatchObject({ AUTH_EMAIL_PASSWORD_ENABLED: "false", AUTH_REQUIRE_EMAIL_VERIFICATION: "false", EMAIL_PROVIDER: "cloudflare" });
    expect(fixture.questions.some((q) => q.question.startsWith("Require email verification"))).toBe(false);
  });

  test("retries invalid answers without reflecting values, and allows declining verification", async () => {
    const fixture = answers(["perhaps", "y", "https://bad.example/path", "https://docs.example.com", "n", "y", "not-an-account", "c".repeat(32), "", "test-token", "invalid-email", "sender@example.com", "N".repeat(201), "Example", "n"]);
    const settings = await collectInstallerConfiguration(fixture.prompt);
    expect(settings.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe("false");
    expect(settings.EMAIL_FROM_NAME).toBe("Example");
    const messages = fixture.messages.join("\n");
    for (const input of ["not-an-account", "test-token", "invalid-email", "N".repeat(201)]) expect(messages).not.toContain(input);
    expect(messages).toContain("Please answer yes or no");
  });

  test("noninteractive installs never prompt and explicit interactive mode requires a terminal", () => {
    expect(shouldPromptForConfiguration("auto", false)).toBe(false);
    expect(shouldPromptForConfiguration("auto", true)).toBe(true);
    expect(shouldPromptForConfiguration("non-interactive", true)).toBe(false);
    expect(() => shouldPromptForConfiguration("interactive", false)).toThrow("requires a terminal");
    expect(() => shouldPromptForConfiguration("invalid", true)).toThrow("Invalid installer setup mode");
  });

  test("saved values round-trip through Bun dotenv without credential expansion or corruption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "installer-dotenv-"));
    try {
      const values = ["", "plain", "name with spaces # hash", "double\"single'quote", "all\"three'quotes`", "literal\\n\\r", "back\\slash", "trailing\\", "test$HOME${PATH}#token", "back\\$HOME", "$(ignored)`ignored`", "Unicode café"];
      const settings = Object.fromEntries(values.map((value, index) => [`SETUP_PROBE_${index}`, value]));
      const contents = renderInstallerConfiguration("# comment\nSETUP_PROBE_1=old\nUNRELATED=kept\n", settings);
      expect(contents).toContain("# comment\n");
      expect(contents).toContain("UNRELATED=kept");
      expect(contents.match(/^SETUP_PROBE_1=/gm)).toHaveLength(1);
      await writeFile(join(directory, "config.env"), contents, { mode: 0o600 });
      const child = Bun.spawn([process.execPath, "--env-file=config.env", "-e", `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(settings))}.map(key => [key, process.env[key]]))))`], {
        cwd: directory, env: { HOME: process.env.HOME!, PATH: process.env.PATH! }, stdout: "pipe", stderr: "pipe",
      });
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(settings);
      expect(await child.exited).toBe(0);
      expect(() => renderInstallerConfiguration("", { BAD: "line\ninjection" })).toThrow();
      expect(() => renderInstallerConfiguration("", { "BAD=KEY": "value" })).toThrow();
      expect(() => renderInstallerConfiguration("", { BAD: "all\"three'quotes`#" })).toThrow("cannot be saved safely");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("a real terminal hides secrets and cancellation saves no answers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "installer-terminal-"));
    const destination = join(directory, "answers.json");
    const script = join(directory, "prompt.ts");
    await writeFile(script, `import {createSetupTerminal,collectInstallerConfiguration} from ${JSON.stringify(join(import.meta.dir, "installerConfiguration.ts"))}; const prompt=createSetupTerminal(); try { const settings=await collectInstallerConfiguration(prompt); await Bun.write(${JSON.stringify(destination)},JSON.stringify(settings)); } catch(error) { console.error(error.message); process.exitCode=1; } finally { prompt.close(); }`);
    const env = { PATH: process.env.PATH!, HOME: process.env.HOME!, TERM: "xterm" };
    try {
      const secret = "synthetic-secret-$HOME-123";
      const result = await inTerminal([process.execPath, "--no-env-file", script], [
        ["reverse proxy? [y/N]: ", "n\n"], ["Google sign-in? [y/N]: ", "y\n"],
        ["Google client ID: ", "synthetic-client\n"], ["Google client secret (hidden): ", `${secret}\n`],
        ["email and password login? [Y/n]: ", "y\n"], ["with Cloudflare? [y/N]: ", "n\n"],
      ], { cwd: directory, env });
      expect(result.code).toBe(0);
      expect(result.answered).toBe(6);
      expect(result.output).not.toContain(secret);
      expect(JSON.parse(await readFile(destination, "utf8")).GOOGLE_CLIENT_SECRET).toBe(secret);
      await rm(destination);
      const cancelled = await inTerminal([process.execPath, "--no-env-file", script], [
        ["reverse proxy? [y/N]: ", "n\n"], ["Google sign-in? [y/N]: ", "y\n"],
        ["Google client ID: ", "synthetic-client\n"], ["Google client secret (hidden): ", `${secret}\u0003`],
      ], { cwd: directory, env });
      expect(cancelled.code).not.toBe(0);
      expect(cancelled.output).not.toContain(secret);
      expect(cancelled.output).toContain("Setup cancelled");
      expect(await Bun.file(destination).exists()).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
