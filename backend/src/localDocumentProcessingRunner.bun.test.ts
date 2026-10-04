import { jsonPath, jsonText } from "./testing/jsonFixture";
import { readObjectResponse } from "./testing/responseFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createConfiguredTestProductStore } from "./testing/workspaceModelFixture";
import type { DocumentClassification, DocumentSplitAssessment } from "./consumer/documentAssessment";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const at = "2026-10-02T17:00:00.000Z";

const selection = (template_id: string): DocumentClassification => ({
  status: "selected",
  template_id,
  reason: "The document is an invoice.",
  evidence: ["Invoice heading"],
});

const uncertain: DocumentClassification = {
  status: "uncertain",
  template_id: null,
  reason: "Compare the payment terms on the final page.",
  evidence: ["Payment terms unclear"],
};

const plan = (groups: number[][]): DocumentSplitAssessment => ({
  status: "resolved",
  groups,
  exclusions: [],
  reason: "Separate invoice headings.",
  evidence: ["Page headings identify each document"],
});

test("real gateway calls retain split reassessments, automatic selection, and rejected extraction response costs", async () => {
  const f = await fixture();
  f.template("tpl_invoice");

  let splitCalls = 0,
    classificationCalls = 0,
    extractionCalls = 0;

  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await readObjectResponse(request);
      const system = jsonText(jsonPath(body, "messages", 0, "content"));

      let result:
          | DocumentClassification
          | DocumentSplitAssessment
          | { results: { field_id: string; status: string; answer: number }[] },
        cost: number;

      if (system.includes("Identify logical document boundaries")) {
        splitCalls++;
        result = { ...plan([[1, 2, 3], [4]]), status: splitCalls === 1 ? "uncertain" : "resolved" };
        cost = 0.01;
      } else if (system.includes("template_id")) {
        classificationCalls++;
        result = selection("tpl_invoice");
        cost = 0.002;
      } else {
        extractionCalls++;
        result = { results: [{ field_id: "total", status: "ok", answer: 42 }] };
        cost = 0.004;
      }

      return Response.json({
        id: `call-${splitCalls}-${classificationCalls}-${extractionCalls}`,
        usage: { cost, prompt_tokens: 10, completion_tokens: 2 },
        choices: [
          { message: { content: extractionCalls === 1 && cost === 0.004 ? "invalid JSON" : JSON.stringify(result) } },
        ],
      });
    },
  });

  cleanups.push(() => {
    gateway.stop(true);
  });
  const configuration = f.store.getModelConfiguration()!;
  f.store.putModelConfiguration({
    expectedRevision: configuration.revision,
    configuration: { ...configuration, gateway_url: gateway.url.toString() },
    updatedAt: at,
  });
  await f.addPacket("cost_packet");
  const runner = f.runner({ extract: undefined });
  await runner.run(f.queued("cost_packet", "packet"));

  for (let work = 0; f.scheduled.length && work < 10; work++) await runner.run(f.scheduled.shift()!);
  const packet = f.store.getDocumentPacket("cost_packet")!;
  expect(packet.status).toBe("completed");
  expect([splitCalls, classificationCalls, extractionCalls]).toEqual([2, 2, 3]);
  expect(packet.costs?.split.amount).toBeCloseTo(0.02, 12);
  expect(packet.costs?.auto_template.amount).toBeCloseTo(0.004, 12);
  expect(packet.costs?.extraction.amount).toBeCloseTo(0.012, 12);
  expect(packet.costs?.total).toMatchObject({ complete: true, reported_calls: 7, unreported_calls: 0 });
  expect(packet.costs?.total.amount).toBeCloseTo(0.036, 12);
  expect(packet.children[0]!.costs?.split.amount).toBeCloseTo(0.015, 12);
  expect(packet.children[1]!.costs?.split.amount).toBeCloseTo(0.005, 12);
});

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-processing-runner-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const workspaceId = "workspace_a";
  const store = createConfiguredTestProductStore({ stateDirectory, workspaceId });
  cleanups.push(() => store.close());
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const scheduled: LocalQueuedExtractionJob[] = [];
  const fields = [{ id: "total", name: "Total", description: "PRIVATE FIELD GUIDANCE", data_type: "number" as const }];

  const template = (id: string, tags = ["invoice"]) =>
    store.createTemplate({ templateId: id, name: id, description: `${id} description`, fields, tags, createdAt: at });

  const queued = (jobId: string, kind?: "packet"): LocalQueuedExtractionJob => ({
    job_id: jobId,
    workspace_id: workspaceId,
    template_id: null,
    template_version: null,
    enqueued_at: at,
    kind,
  });

  const addJob = async (jobId: string, templateId: string | null = null, tags = ["invoice"]) => {
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId,
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    store.createQueuedExtractionJob({
      jobId,
      templateId,
      templateVersion: templateId ? 1 : null,
      templateTags: tags,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "test.png",
      sourceFilePageCount: null,
      submittedAt: at,
    });

    return sourceFileKey;
  };

  const addPacket = async (
    packetId: string,
    options: { templateId?: string; retained?: boolean; blank?: boolean } = {},
  ) => {
    const pdf = await PDFDocument.create();

    for (let page = 1; page <= 4; page++) pdf.addPage([100 + page, 100]);

    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: packetId,
      mimeType: "application/pdf",
      bytes: await pdf.save(),
    });

    store.createDocumentPacket({
      packetId,
      templateId: options.templateId ?? null,
      templateVersion: options.templateId ? 1 : null,
      templateTags: ["invoice"],
      selectedPages: [1, 2, 3, 4],
      processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: options.blank ?? false },
      sourceFileKey,
      sourceMimeType: "application/pdf",
      sourceName: "packet.pdf",
      sourceFilePageCount: 4,
      sourceRetained: options.retained ?? false,
      submittedAt: at,
    });

    return sourceFileKey;
  };

  const runner = (options: Partial<Parameters<typeof createLocalExtractionRunner>[0]> = {}) =>
    createLocalExtractionRunner({
      stateDirectory,
      sourceFileStore: sourceFiles,
      now: () => at,
      extract: async () => [{ field_id: "total", status: "ok", answer: 42, confidence: 1, evidence: "42" }],
      scheduleJob: (job) => {
        scheduled.push(job);
      },
      ...options,
    });

  return {
    stateDirectory,
    workspaceId,
    store,
    sourceFiles,
    scheduled,
    fields,
    template,
    queued,
    addJob,
    addPacket,
    runner,
  };
}

test("automatic jobs filter tags with any-match and classify using only metadata and the configured role", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  f.template("tpl_finance", ["finance"]);
  f.template("tpl_receipt", ["receipt"]);
  const configuration = f.store.getModelConfiguration()!;
  f.store.putModelConfiguration({
    expectedRevision: configuration.revision,
    configuration: {
      ...configuration,
      classification_model: {
        model_name: "classification/model",
        supports_pdf_input: false,
        supports_structured_output: true,
      },
    },
    updatedAt: at,
  });
  await f.addJob("job_auto", null, ["invoice", "finance"]);
  let calls = 0;

  const runner = f.runner({
    classify: async (environment, input) => {
      calls++;
      expect(environment).toMatchObject({
        AI_MODEL: "classification/model",
        MODEL_SUPPORTS_PDF_INPUT: "false",
        MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true",
      });
      expect(input.candidates.map(({ id }) => id)).toEqual(["tpl_finance", "tpl_invoice"]);
      expect(JSON.stringify(input.candidates)).not.toContain("PRIVATE FIELD GUIDANCE");
      expect(
        input.candidates.every((candidate) => Object.keys(candidate).sort().join(",") === "description,id,name"),
      ).toBe(true);

      return selection("tpl_invoice");
    },
  });

  await runner.run(f.queued("job_auto"));
  expect(calls).toBe(1);
  expect(f.store.getExtractionJob("job_auto")).toMatchObject({
    status: "completed",
    template_id: "tpl_invoice",
    template_version: 1,
    model_name: "test/model",
  });
  expect(f.store.getDocumentRouting("job_auto")).toMatchObject({
    routing_rounds: 1,
    configuration_snapshot: { model_name: "classification/model" },
  });
  await runner.run(f.queued("job_auto"));
  expect(calls).toBe(1);
});

test("uncertainty stops after initial plus two rounds, preserves source, and never resets on restart", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  const source = await f.addJob("job_auto");
  f.store.claimRoutingRound({ jobId: "job_auto", updatedAt: at, configurationSnapshot: { model_name: "old/model" } });
  f.store.recordRoutingAssessment({
    jobId: "job_auto",
    round: 1,
    reason: uncertain.reason,
    evidence: uncertain.evidence,
    updatedAt: at,
  });
  let calls = 0;

  const classify = async (
    _environment: Parameters<NonNullable<Parameters<typeof createLocalExtractionRunner>[0]["classify"]>>[0],
    input: { previous?: { reason: string } },
  ) => {
    calls++;
    expect(input.previous?.reason).toBe(uncertain.reason);

    return uncertain;
  };

  await f.runner({ classify }).run(f.queued("job_auto"));
  expect(calls).toBe(2);
  expect(f.store.getExtractionJobSummary("job_auto")?.status).toBe("awaiting_template");
  expect(f.store.getDocumentRouting("job_auto")?.routing_rounds).toBe(3);
  expect(await f.sourceFiles.read(source)).not.toBeNull();
  await f.runner({ classify }).run(f.queued("job_auto"));
  expect(calls).toBe(2);
});

test("no matching candidates makes no model call; an explicit template bypasses classification", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_unknown", null, ["unknown"]);
  await f.addJob("job_explicit", "tpl_invoice", ["unknown"]);
  let calls = 0;

  const runner = f.runner({
    classify: async () => {
      calls++;

      return selection("tpl_invoice");
    },
  });

  await runner.run(f.queued("job_unknown"));
  await runner.run(f.queued("job_explicit"));
  expect(calls).toBe(0);
  expect(f.store.getExtractionJobSummary("job_unknown")?.status).toBe("awaiting_template");
  expect(f.store.getDocumentRouting("job_unknown")?.routing_rounds).toBe(0);
  expect(f.store.getExtractionJobSummary("job_explicit")?.status).toBe("completed");
});

test("tag edits during classification prevent stale selection and do not broaden the scope", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  f.template("tpl_receipt", ["receipt"]);
  await f.addJob("job_auto");
  let calls = 0;
  await f
    .runner({
      classify: async () => {
        calls++;
        f.store.updateTemplate({ templateId: "tpl_invoice", tags: [], updatedAt: at });

        return selection("tpl_invoice");
      },
    })
    .run(f.queued("job_auto"));
  expect(calls).toBe(1);
  expect(f.store.getExtractionJobSummary("job_auto")).toMatchObject({ template_id: null, status: "awaiting_template" });
});

test("a clear split creates stable page-isolated children which route independently", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  f.template("tpl_finance", ["invoice"]);
  const original = await f.addPacket("pkt_auto");
  let splitCalls = 0;
  const seenPages: number[][] = [];

  const runner = f.runner({
    splitDocument: async () => {
      splitCalls++;

      return plan([
        [1, 2],
        [3, 4],
      ]);
    },
    classify: async (_environment, input) => {
      const pages = (await PDFDocument.load(await input.source.arrayBuffer()))
        .getPages()
        .map((page) => page.getWidth());

      seenPages.push(pages);

      return selection(pages[0] === 101 ? "tpl_invoice" : "tpl_finance");
    },
    extract: async ({ sourceBytes }) => {
      const pages = (await PDFDocument.load(sourceBytes)).getPages().map((page) => page.getWidth());
      expect([
        [101, 102],
        [103, 104],
      ]).toContainEqual(pages);

      return [{ field_id: "total", status: "ok", answer: 42, confidence: 1, evidence: "42" }];
    },
  });

  await runner.run(f.queued("pkt_auto", "packet"));
  const packet = f.store.getDocumentPacket("pkt_auto")!;
  expect(packet.child_slots.map((child) => child.pages)).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(f.scheduled).toHaveLength(2);

  for (const child of f.scheduled) await runner.run(child);
  expect(seenPages).toEqual([
    [101, 102],
    [103, 104],
  ]);
  expect(f.store.getDocumentPacket("pkt_auto")?.status).toBe("completed");
  expect(await f.sourceFiles.read(original)).toBeNull();
  await runner.run(f.queued("pkt_auto", "packet"));
  expect(splitCalls).toBe(1);
  expect(f.store.getDocumentPacket("pkt_auto")?.child_slots.map((child) => child.job_id)).toEqual(
    packet.child_slots.map((child) => child.job_id),
  );
  expect(f.scheduled).toHaveLength(2);
});

test("verified all-blank packets complete with no children or classification and honor retained source policy", async () => {
  for (const retained of [false, true]) {
    const f = await fixture();
    f.template("tpl_invoice");
    const original = await f.addPacket("pkt_blank", { blank: true, retained });
    let classificationCalls = 0;

    const runner = f.runner({
      splitDocument: async () => ({
        ...plan([]),
        exclusions: [1, 2, 3, 4].map((page) => ({ page, reason: "Verified blank", verified_blank: true })),
      }),
      classify: async () => {
        classificationCalls++;

        return selection("tpl_invoice");
      },
    });

    await runner.run(f.queued("pkt_blank", "packet"));
    await f.runner().run(f.queued("pkt_blank", "packet"));
    expect(f.store.getDocumentPacket("pkt_blank")).toMatchObject({
      status: "completed",
      outcome: "no_documents",
      children: [],
      assessment_rounds: 1,
    });
    expect(f.scheduled).toHaveLength(0);
    expect(classificationCalls).toBe(0);
    expect(Boolean(await f.sourceFiles.read(original))).toBe(retained);
  }
});

test("explicit packet children keep the accepted template version through template edits and deletion", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addPacket("pkt_explicit", { templateId: "tpl_invoice" });
  f.store.updateTemplate({ templateId: "tpl_invoice", fields: [{ ...f.fields[0]!, id: "new_field" }], updatedAt: at });
  f.store.deleteTemplate({ templateId: "tpl_invoice", deletedAt: at });

  const runner = f.runner({
    splitDocument: async () =>
      plan([
        [1, 2],
        [3, 4],
      ]),
    classify: async () => {
      throw new Error("Explicit children must not classify");
    },
    extract: async ({ fields }) => {
      expect(fields).toEqual(f.fields);

      return [];
    },
  });

  await runner.run(f.queued("pkt_explicit", "packet"));
  expect(f.scheduled).toHaveLength(2);

  for (const child of f.scheduled) {
    expect(child).toMatchObject({ template_id: "tpl_invoice", template_version: 1 });
    await runner.run(child);
    expect(f.store.getExtractionJobSummary(child.job_id)?.status).toBe("completed");
  }
});

test("uncertain splitting uses three persisted rounds and holds without creating runnable children", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  const original = await f.addPacket("pkt_uncertain");
  let calls = 0;

  const splitDocument = async (): Promise<DocumentSplitAssessment> => {
    calls++;

    return { ...plan([[1, 2, 3, 4]]), status: "uncertain" };
  };

  await f.runner({ splitDocument }).run(f.queued("pkt_uncertain", "packet"));
  await f.runner({ splitDocument }).run(f.queued("pkt_uncertain", "packet"));
  expect(calls).toBe(3);
  expect(f.store.getDocumentPacket("pkt_uncertain")).toMatchObject({
    status: "awaiting_review",
    assessment_rounds: 3,
    children: [],
    plan: { groups: [{ pages: [1, 2, 3, 4] }] },
  });
  expect(f.scheduled).toHaveLength(0);
  expect(await f.sourceFiles.read(original)).not.toBeNull();
});

test("committed partial fan-out resumes without reassessment or recreating deleted children", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addPacket("pkt_resume", { templateId: "tpl_invoice" });
  f.store.claimPacketRound({ packetId: "pkt_resume", updatedAt: at, configurationSnapshot: {} });

  const packet = f.store.acceptDocumentPacketPlan({
    packetId: "pkt_resume",
    revision: 1,
    expectedRound: 1,
    groups: [
      [1, 2],
      [3, 4],
    ],
    exclusions: [],
    updatedAt: at,
  })!;

  const first = packet.child_slots[0]!;

  const sourceKey = await f.sourceFiles.write({
    workspaceId: f.workspaceId,
    jobId: first.job_id,
    mimeType: "application/pdf",
    bytes: new Uint8Array([1]),
  });

  f.store.materializePacketChild({
    packetId: packet.packet_id,
    jobId: first.job_id,
    sourceFileKey: sourceKey,
    sourceFilePageCount: 2,
    updatedAt: at,
  });
  f.store.deleteExtractionJob({ jobId: first.job_id });

  const runner = f.runner({
    splitDocument: async () => {
      throw new Error("Committed plans must not reassess");
    },
  });

  await runner.run(f.queued("pkt_resume", "packet"));
  expect(f.scheduled.map((job) => job.job_id)).toEqual([packet.child_slots[1]!.job_id]);
  expect(f.store.getExtractionJobSummary(first.job_id)).toBeNull();
  expect(f.store.getDocumentPacket("pkt_resume")?.child_slots[0]?.state).toBe("deleted");
});

test("deletion cancels assessment and ignores its late result", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_cancel");
  const operations = createLocalWorkspaceProductOperations();
  let started!: () => void;

  const start = new Promise<void>((resolve) => {
    started = resolve;
  });

  let release!: () => void;

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  const running = f
    .runner({
      workspaceProductOperations: operations,
      classify: async () => {
        started();
        await pending;

        return selection("tpl_invoice");
      },
    })
    .run(f.queued("job_cancel"));

  await start;
  const deletion = operations.beginDocumentDeletion({ workspaceId: f.workspaceId, jobId: "job_cancel" });
  release();
  await running;
  await deletion;
  expect(f.store.getExtractionJobSummary("job_cancel")?.template_id).toBeNull();
  f.store.deleteExtractionJob({ jobId: "job_cancel" });
  operations.completeDocumentDeletion({ workspaceId: f.workspaceId, jobId: "job_cancel" });
  expect(f.store.getExtractionJobSummary("job_cancel")).toBeNull();
});

test("a resolving follow-up stops immediately and transport retries do not consume new decision rounds", async () => {
  const { RetryableError } = await import("./consumer/modelGateway");
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_retry");
  let calls = 0;
  await f
    .runner({
      classify: async () => {
        calls++;

        if (calls === 1) return uncertain;

        if (calls === 2) throw new RetryableError("HTTP 503");

        return selection("tpl_invoice");
      },
    })
    .run(f.queued("job_retry"));
  expect(calls).toBe(3);
  expect(f.store.getDocumentRouting("job_retry")?.routing_rounds).toBe(2);
  expect(f.store.getExtractionJobSummary("job_retry")?.status).toBe("completed");
});

test("remote retained children get independent manifest ownership and the parent keeps its original", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  const original = await f.addPacket("pkt_remote", { templateId: "tpl_invoice", retained: true });
  // Capture remote retention at packet acceptance, as the ordinary upload path does.
  const { Database } = await import("bun:sqlite");
  const database = new Database(join(f.stateDirectory, "data", "workspaces", `${f.workspaceId}.sqlite`));
  database.query("UPDATE source_files SET retained_key='parent-original' WHERE job_id='pkt_remote'").run();
  database.close();
  const prepared: Array<{ objectKey: string; ownerKind: string; ownerId: string }> = [];
  const linked: string[] = [];
  const removed: string[] = [];
  const objects = new Map<string, Blob>();

  const sourceObjects = {
    keyFor: ({ jobId }: { jobId: string }) => `remote-${jobId}`,
    store: {
      put: async ({ key, file }: { key: string; file: Blob }) => {
        objects.set(key, file);
      },
      open: async (key: string) => {
        const file = objects.get(key)!;

        return { size: file.size, stream: () => file.stream() };
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
    },
    manifest: {
      prepare: (entry: { objectKey: string; ownerKind: string; ownerId: string }) => {
        prepared.push(entry);
      },
      link: ({ objectKey }: { objectKey: string }) => {
        linked.push(objectKey);

        return true;
      },
      markDeleting: ({ objectKey }: { objectKey: string }) => {
        removed.push(objectKey);
      },
      markJobDeleting: () => {},
      markWorkspaceDeleting: () => {},
    },
  };

  const runner = f.runner({
    sourceObjects,
    splitDocument: async () =>
      plan([
        [1, 2],
        [3, 4],
      ]),
  });

  await runner.run(f.queued("pkt_remote", "packet"));
  expect(prepared).toHaveLength(2);
  expect(prepared.map((entry) => entry.ownerKind)).toEqual(["job", "job"]);
  expect(linked).toHaveLength(2);
  expect(removed).toEqual([]);
  expect(await f.sourceFiles.read(original)).toBeNull();
  expect(f.store.getProcessingSource("pkt_remote")?.retained_object_key).toBe("parent-original");

  for (const child of f.scheduled) {
    const retained = f.store.getRetainedSourceFile(child.job_id)!;
    expect(retained.retained_object_key).toBe(`remote-${child.job_id}`);
    expect(
      (await PDFDocument.load(await objects.get(retained.retained_object_key!)!.arrayBuffer())).getPageCount(),
    ).toBe(2);
    await runner.run(child);
    expect(await f.sourceFiles.read(retained.source_file_key)).toBeNull();
    expect(f.store.getRetainedSourceFile(child.job_id)?.retained_object_key).toBe(`remote-${child.job_id}`);
  }
});

test("recovery schedules packet analysis and ordinary unbound jobs without model work", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_pending");
  await f.addPacket("pkt_pending");
  let calls = 0;
  await f
    .runner({
      classify: async () => {
        calls++;

        return uncertain;
      },
    })
    .recover(f.workspaceId);
  expect(calls).toBe(0);
  expect(f.scheduled).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ job_id: "job_pending", template_id: null }),
      expect.objectContaining({ job_id: "pkt_pending", kind: "packet", template_id: null }),
    ]),
  );
});

test("exhausted transport attempts hold once and cannot reset their allowance by recovery", async () => {
  const { RetryableError } = await import("./consumer/modelGateway");
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_transport");
  let calls = 0;

  const classify = async (): Promise<DocumentClassification> => {
    calls++;
    throw new RetryableError("HTTP 503");
  };

  await f.runner({ classify }).run(f.queued("job_transport"));
  expect(calls).toBe(3);
  expect(f.store.getExtractionJobSummary("job_transport")?.status).toBe("awaiting_template");
  expect(f.store.getDocumentRouting("job_transport")?.routing_rounds).toBe(1);
  await f.runner({ classify }).recover(f.workspaceId);
  await f.runner({ classify }).run(f.queued("job_transport"));
  expect(f.scheduled).toHaveLength(0);
  expect(calls).toBe(3);
});

test("each classification round snapshots the current role without resetting prior work", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addJob("job_configuration");
  const models: string[] = [];
  await f
    .runner({
      classify: async (environment) => {
        models.push(environment.AI_MODEL!);

        if (models.length === 1) {
          const configuration = f.store.getModelConfiguration()!;
          f.store.putModelConfiguration({
            expectedRevision: configuration.revision,
            configuration: {
              ...configuration,
              classification_model: {
                model_name: "new/classification",
                supports_pdf_input: true,
                supports_structured_output: false,
              },
            },
            updatedAt: at,
          });

          return uncertain;
        }

        return selection("tpl_invoice");
      },
    })
    .run(f.queued("job_configuration"));
  expect(models).toEqual(["test/model", "new/classification"]);
  const routing = f.store.getDocumentRouting("job_configuration")!;
  expect(routing.routing_rounds).toBe(2);
  expect(routing.configuration_snapshot).toMatchObject({
    model_name: "new/classification",
    supports_structured_output: false,
  });
  expect(JSON.stringify(routing.configuration_snapshot)).not.toContain("dummy-test-key");
  expect(JSON.stringify(routing.configuration_snapshot)).not.toContain("ciphertext");
});

test("partial remote fan-out failure preserves committed children, releases failed artifacts, and never retries the failed parent", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  const original = await f.addPacket("pkt_partial", { templateId: "tpl_invoice", retained: true });
  const { Database } = await import("bun:sqlite");
  const database = new Database(join(f.stateDirectory, "data", "workspaces", `${f.workspaceId}.sqlite`));
  database.query("UPDATE source_files SET retained_key='parent-original' WHERE job_id='pkt_partial'").run();
  database.close();
  let writes = 0;
  let splitCalls = 0;
  const deleting: string[] = [];

  const sourceObjects = {
    keyFor: ({ jobId }: { jobId: string }) => `remote-${jobId}`,
    store: {
      put: async () => {
        if (++writes === 2) throw new Error("Retained storage unavailable");
      },
      open: async () => {
        throw new Error("Not expected");
      },
      delete: async () => {},
    },
    manifest: {
      prepare: () => {},
      link: () => true,
      markDeleting: ({ objectKey }: { objectKey: string }) => {
        deleting.push(objectKey);
      },
      markJobDeleting: () => {},
      markWorkspaceDeleting: () => {},
    },
  };

  const runner = f.runner({
    sourceObjects,
    splitDocument: async () => {
      splitCalls++;

      return plan([
        [1, 2],
        [3, 4],
      ]);
    },
  });

  await runner.run(f.queued("pkt_partial", "packet"));
  const failed = f.store.getDocumentPacket("pkt_partial")!;
  expect(failed.status).toBe("failed");
  expect(failed.child_slots.map((slot) => slot.state)).toEqual(["materialized", "deleted"]);
  expect(f.store.listRetainedTerminalSourceFiles({ failedBefore: at })).toContainEqual({
    job_id: failed.child_slots[1]!.job_id,
    source_file_key: failed.child_slots[1]!.source_file_key!,
    retained_object_key: `remote-${failed.child_slots[1]!.job_id}`,
  });
  expect(failed.children).toHaveLength(1);
  expect(await f.sourceFiles.read(original)).not.toBeNull();
  expect(await f.sourceFiles.read(failed.child_slots[1]!.source_file_key!)).toBeNull();
  expect(deleting).toEqual([`remote-${failed.child_slots[1]!.job_id}`]);
  await runner.recover(f.workspaceId);
  expect(f.scheduled.map((job) => job.job_id)).toEqual([failed.child_slots[0]!.job_id]);
  await runner.run(f.scheduled[0]!);
  await runner.run(f.queued("pkt_partial", "packet"));
  expect(f.store.getDocumentPacket("pkt_partial")?.status).toBe("failed");
  expect(f.store.getExtractionJobSummary(failed.child_slots[0]!.job_id)?.status).toBe("completed");
  expect(splitCalls).toBe(1);
  expect(writes).toBe(2);
});

test("materialized artifacts remain under shared memory admission through persistence and release on failure", async () => {
  const { getModelPreparationSnapshot } = await import("./consumer/modelGateway");
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addPacket("pkt_memory", { templateId: "tpl_invoice" });
  const baseline = getModelPreparationSnapshot().reservedBytes;
  let reservedDuringMaterialization = 0;

  const runner = f.runner({
    splitDocument: async () =>
      plan([
        [1, 2],
        [3, 4],
      ]),
    materializePages: async () => {
      reservedDuringMaterialization = getModelPreparationSnapshot().reservedBytes;
      throw new Error("Bounded artifact generation failed");
    },
  });

  await runner.run(f.queued("pkt_memory", "packet"));
  expect(reservedDuringMaterialization).toBeGreaterThan(baseline);
  expect(getModelPreparationSnapshot().reservedBytes).toBe(baseline);
  expect(f.store.getDocumentPacket("pkt_memory")?.status).toBe("failed");
  expect(f.scheduled).toHaveLength(0);
});

test("manual all-blank completion immediately cleans the unretained original without model work", async () => {
  const f = await fixture();
  f.template("tpl_invoice");
  const original = await f.addPacket("pkt_manual_blank", { templateId: "tpl_invoice", blank: true });
  f.store.holdDocumentPacket({ packetId: "pkt_manual_blank", reason: "Review blank pages", updatedAt: at });

  const accepted = f.store.acceptDocumentPacketPlan({
    packetId: "pkt_manual_blank",
    revision: 1,
    manual: true,
    groups: [],
    updatedAt: at,
    exclusions: [1, 2, 3, 4].map((page) => ({ page, reason: "Verified blank", verified_blank: true })),
    verifiedBlankPages: [1, 2, 3, 4],
  });

  expect(accepted?.outcome).toBe("no_documents");
  await f
    .runner({
      splitDocument: async () => {
        throw new Error("Completed work must not reassess");
      },
    })
    .run(f.queued("pkt_manual_blank", "packet"));
  expect(await f.sourceFiles.read(original)).toBeNull();
  expect(f.scheduled).toHaveLength(0);
  expect(f.store.getDocumentPacket("pkt_manual_blank")?.status).toBe("completed");
});

test("temporary PDF capacity retries materialization without repeating assessment or child identities", async () => {
  const { PdfSourceFileCapacityError } = await import("./lib/sourceFilePageCount");
  const { materializePdfPageGroups } = await import("./lib/pdfPageOperations");
  const f = await fixture();
  f.template("tpl_invoice");
  await f.addPacket("pkt_capacity", { templateId: "tpl_invoice" });
  let assessments = 0;
  let materializations = 0;

  const runner = f.runner({
    splitDocument: async () => {
      assessments++;

      return plan([
        [1, 2],
        [3, 4],
      ]);
    },
    materializePages: async (...args) => {
      if (++materializations === 1) throw new PdfSourceFileCapacityError();

      return materializePdfPageGroups(...args);
    },
  });

  await runner.run(f.queued("pkt_capacity", "packet"));

  for (const child of f.scheduled) await runner.run(child);
  expect(assessments).toBe(1);
  expect(materializations).toBe(2);
  expect(f.scheduled).toHaveLength(2);
  expect(new Set(f.scheduled.map((child) => child.job_id)).size).toBe(2);
  expect(f.store.getDocumentPacket("pkt_capacity")).toMatchObject({ status: "completed", assessment_rounds: 1 });
});
