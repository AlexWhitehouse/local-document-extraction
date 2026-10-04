import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalSourceObjectManifest } from "../backend/src/localSourceObjectManifest";
import { sourceObjectDestination } from "../backend/src/s3SourceObjectStore";
import { readLocalConfiguration } from "../backend/src/localConfiguration";
import { renderInstallerConfiguration } from "./installerConfiguration";
import {
  collectSourceStorageSettings,
  configureSourceStorage,
  dependentSourceDestination,
  parseConfigurationValues,
  probeS3SourceStorage,
} from "./sourceStorageSetup";
import { startFakeS3Server } from "../backend/src/testing/fakeS3Server";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function answers(responses: string[]) {
  const questions: { question: string; secret: boolean }[] = [];
  const messages: string[] = [];

  return {
    questions,
    messages,
    prompt: {
      async ask(question: string, secret = false) {
        questions.push({ question, secret });
        const response = responses.shift();

        if (response === undefined) throw new Error(`Unexpected question: ${question}`);

        return response;
      },
      say(message: string) {
        messages.push(message);
      },
    },
  };
}

const S3_CURRENT = {
  SOURCE_STORAGE_PROVIDER: "s3",
  SOURCE_ORIGINAL_RETENTION_ENABLED: "true",
  SOURCE_STORAGE_S3_ENDPOINT: "http://rustfs:9000",
  SOURCE_STORAGE_S3_REGION: "us-east-1",
  SOURCE_STORAGE_S3_BUCKET: "documents",
  SOURCE_STORAGE_S3_PREFIX: "document-extraction/",
  SOURCE_STORAGE_S3_FORCE_PATH_STYLE: "true",
  SOURCE_STORAGE_S3_ACCESS_KEY_ID: "old-access",
  SOURCE_STORAGE_S3_SECRET_ACCESS_KEY: "old-secret",
  SOURCE_STORAGE_S3_SESSION_TOKEN: "",
};

describe("Source storage setup", () => {
  test("a first install defaults to no storage with a single question and no probe", async () => {
    const fixture = answers([""]);

    const probe = async () => {
      throw new Error("must not probe");
    };

    const settings = await collectSourceStorageSettings(fixture.prompt, { probe });
    expect(settings).toMatchObject({ SOURCE_STORAGE_PROVIDER: "none", SOURCE_ORIGINAL_RETENTION_ENABLED: "false" });
    expect(fixture.questions).toHaveLength(1);
    expect(await collectSourceStorageSettings(answers(["local"]).prompt, { probe })).toMatchObject({
      SOURCE_STORAGE_PROVIDER: "local",
      SOURCE_ORIGINAL_RETENTION_ENABLED: "true",
    });
  });

  test("S3 setup shows the bucket requirement, needs explicit confirmation and probes before returning", async () => {
    const probed: string[] = [];

    const probe = async (s3: { bucket: string }) => {
      probed.push(s3.bucket);
    };

    const fixture = answers(["s3", "http://rustfs:9000", "", "documents", "", "", "access", "secret", "", "y"]);
    const settings = await collectSourceStorageSettings(fixture.prompt, { probe });
    expect(settings).toMatchObject({
      SOURCE_STORAGE_PROVIDER: "s3",
      SOURCE_STORAGE_S3_ENDPOINT: "http://rustfs:9000",
      SOURCE_STORAGE_S3_REGION: "us-east-1",
      SOURCE_STORAGE_S3_BUCKET: "documents",
      SOURCE_STORAGE_S3_PREFIX: "document-extraction/",
      SOURCE_STORAGE_S3_FORCE_PATH_STYLE: "true",
      SOURCE_STORAGE_S3_ACCESS_KEY_ID: "access",
      SOURCE_STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      SOURCE_ORIGINAL_RETENTION_ENABLED: "true",
    });
    expect(probed).toEqual(["documents"]);
    expect(fixture.questions.find((q) => q.question.startsWith("Confirm this bucket"))?.question).toContain("[y/N]");
    expect(fixture.questions.filter((q) => q.secret).map((q) => q.question)).toEqual([
      "Secret access key (hidden)",
      "Session token for temporary credentials (hidden, optional) (Enter for none)",
    ]);
    expect(fixture.messages.join("\n")).toContain("must not use object versioning or Object Lock");
    expect(fixture.messages.join("\n")).not.toContain("secret\n");
  });

  test("declining the requirement or failing the probe saves nothing", async () => {
    const declined = answers(["s3", "", "eu-west-2", "documents", "", "", "access", "secret", "", ""]);
    await expect(collectSourceStorageSettings(declined.prompt, { probe: async () => {} })).rejects.toThrow(
      "requirement was not confirmed",
    );
    const failing = answers(["s3", "", "eu-west-2", "documents", "", "", "access", "secret", ""]);
    await expect(
      collectSourceStorageSettings(failing.prompt, {
        probe: async () => {
          throw new Error("could not write a test object");
        },
        confirmUnversionedBucket: true,
      }),
    ).rejects.toThrow("Storage settings unchanged: could not write a test object");
  });

  test("credential rotation keeps the destination, skips the confirmation and still probes", async () => {
    let probes = 0;
    const fixture = answers(["", "", "", "", "", "", "", "new-secret", "", ""]);

    const settings = await collectSourceStorageSettings(fixture.prompt, {
      current: S3_CURRENT,
      probe: async () => {
        probes += 1;
      },
      askRetention: true,
      dependentDestination: sourceObjectDestination(
        readLocalConfiguration({ environment: S3_CURRENT }).sourceStorage.s3!,
      ),
    });

    expect(settings).toMatchObject({
      SOURCE_STORAGE_S3_ACCESS_KEY_ID: "old-access",
      SOURCE_STORAGE_S3_SECRET_ACCESS_KEY: "new-secret",
    });
    expect(probes).toBe(1);
    expect(fixture.questions.some((q) => q.question.startsWith("Confirm this bucket"))).toBe(false);
    expect(fixture.questions.some((q) => q.question.includes("old-secret") || q.question.includes("old-access"))).toBe(
      false,
    );
  });

  test("a destination with dependent originals cannot be changed or removed, but retention can stop for new uploads", async () => {
    const dependentDestination = sourceObjectDestination(
      readLocalConfiguration({ environment: S3_CURRENT }).sourceStorage.s3!,
    );

    const probe = async () => {};

    await expect(
      collectSourceStorageSettings(answers(["", "", "", "other-bucket", "", "", "", "", ""]).prompt, {
        current: S3_CURRENT,
        probe,
        dependentDestination,
      }),
    ).rejects.toThrow("still depend on the current S3");
    await expect(
      collectSourceStorageSettings(answers(["local"]).prompt, { current: S3_CURRENT, probe, dependentDestination }),
    ).rejects.toThrow("still depend on the current S3");

    const stopped = await collectSourceStorageSettings(answers(["", "", "", "", "", "", "", "", "", "n"]).prompt, {
      current: S3_CURRENT,
      probe,
      dependentDestination,
      askRetention: true,
    });

    expect(stopped).toMatchObject({
      SOURCE_STORAGE_PROVIDER: "s3",
      SOURCE_STORAGE_S3_BUCKET: "documents",
      SOURCE_ORIGINAL_RETENTION_ENABLED: "false",
    });
  });
});

describe("S3 session tokens", () => {
  test("temporary credentials can be added, rotated and removed without echoing the token", async () => {
    let probes = 0;

    const probe = async () => {
      probes += 1;
    };

    const current = { ...S3_CURRENT, SOURCE_STORAGE_S3_SESSION_TOKEN: "old-token" };
    const keep = answers(["", "", "", "", "", "", "", "", "", ""]);
    expect(await collectSourceStorageSettings(keep.prompt, { current, probe, askRetention: true })).toMatchObject({
      SOURCE_STORAGE_S3_SESSION_TOKEN: "old-token",
    });
    expect(probes).toBe(0);
    const rotated = answers(["", "", "", "", "", "", "", "", "new-token", ""]);
    expect(await collectSourceStorageSettings(rotated.prompt, { current, probe, askRetention: true })).toMatchObject({
      SOURCE_STORAGE_S3_SESSION_TOKEN: "new-token",
    });
    expect(probes).toBe(1);
    const removed = answers(["", "", "", "", "", "", "", "", "-", ""]);
    expect(await collectSourceStorageSettings(removed.prompt, { current, probe, askRetention: true })).toMatchObject({
      SOURCE_STORAGE_S3_SESSION_TOKEN: "",
    });
    expect([...keep.questions, ...rotated.questions].some((q) => q.question.includes("old-token"))).toBe(false);
  });
});

describe("storage configure", () => {
  test("round-trips config.env values and saves atomically with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "storage-configure-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const configFile = join(root, "config.env");
    await writeFile(
      configFile,
      renderInstallerConfiguration("# Settings\nPORT=8787\nSOURCE_STORAGE_PROVIDER=none\n", {
        EMAIL_FROM_NAME: "Docs $HOME's `app`",
      }),
      { mode: 0o600 },
    );
    expect(parseConfigurationValues(await readFile(configFile, "utf8"))).toMatchObject({
      PORT: "8787",
      EMAIL_FROM_NAME: "Docs $HOME's `app`",
    });
    const installation = { configFile, state: join(root, "state") };
    const fixture = answers(["s3", "", "eu-west-2", "documents", "", "", "access", "top$secret", "", ""]);
    await configureSourceStorage(installation, {
      prompt: fixture.prompt,
      probe: async () => {},
      confirmUnversionedBucket: true,
    });
    const saved = await readFile(configFile, "utf8");
    expect(parseConfigurationValues(saved)).toMatchObject({
      PORT: "8787",
      SOURCE_STORAGE_PROVIDER: "s3",
      SOURCE_STORAGE_S3_BUCKET: "documents",
      SOURCE_STORAGE_S3_SECRET_ACCESS_KEY: "top$secret",
      SOURCE_ORIGINAL_RETENTION_ENABLED: "true",
    });
    expect(saved).toStartWith("# Settings\n");
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    expect(fixture.messages.join("\n")).not.toContain("top$secret");
    expect(fixture.messages.at(-1)).toContain("document-extraction start");
  });

  test("reads dependent destinations from the control database without modifying it", async () => {
    const state = await mkdtemp(join(tmpdir(), "storage-dependencies-"));
    cleanups.push(() => rm(state, { recursive: true, force: true }));
    expect(dependentSourceDestination(state)).toBeNull();
    await mkdir(join(state, "data"));
    const database = new Database(join(state, "data", "control.sqlite"));
    const manifest = createLocalSourceObjectManifest(database);
    manifest.assertDestination("s3|http://rustfs:9000|documents|document-extraction/|path");
    expect(dependentSourceDestination(state)).toBeNull();
    manifest.prepare({
      objectKey: "document-extraction/key.pdf",
      workspaceId: "workspace_a",
      ownerKind: "job",
      ownerId: "job_a",
    });
    database.close();
    expect(dependentSourceDestination(state)).toBe("s3|http://rustfs:9000|documents|document-extraction/|path");
  });

  test("the probe writes, reads back and deletes a synthetic object", async () => {
    const s3 = startFakeS3Server();
    cleanups.push(s3.stop);

    const configuration = readLocalConfiguration({
      environment: { ...S3_CURRENT, SOURCE_STORAGE_S3_ENDPOINT: s3.endpoint },
    }).sourceStorage.s3!;

    await probeS3SourceStorage(configuration);
    expect(s3.state.puts).toBe(1);
    expect(s3.objects.size).toBe(0);
    s3.state.down = true;
    await expect(probeS3SourceStorage(configuration)).rejects.toThrow(
      /could not write a test object.*\.setup-probe\/.*appears in the bucket later/,
    );
  });
});
