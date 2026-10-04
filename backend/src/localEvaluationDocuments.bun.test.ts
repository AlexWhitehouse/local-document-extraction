import { jsonArray, jsonText } from "./testing/jsonFixture";
import { isNumber, isString, type JsonValue } from "../../shared/json";
import { readObjectResponse, jsonTextFields } from "./testing/responseFixture";

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFDocument } from "pdf-lib";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import type { LocalSourceStorageConfiguration } from "./localConfiguration";
import { createLocalEvaluationDocuments } from "./localEvaluationDocuments";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createSignedInUser } from "./testing/localAuthTestClient";

function evaluationDocument(value: JsonValue | undefined) {
  const document = jsonTextFields(value, "id", "name");

  if (!isNumber(document.revision) || !Number.isSafeInteger(document.revision) || document.revision < 1)
    throw new Error("Expected a positive document revision");

  return { ...document, revision: document.revision };
}

async function readDocumentResponse(response: Response) {
  const payload = await readObjectResponse(response);

  return { ...payload, document: evaluationDocument(payload.document), reference: payload.reference };
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ORIGIN = "http://127.0.0.1:8787";

const definitions = {
  "total:number": { id: "total", name: "Total", data_type: "number", description: "" },
  "vendor:string": { id: "vendor", name: "Vendor", data_type: "string", description: "" },
};

const reference = (total: JsonValue = 0) => ({
  version: 1,
  definitions,
  references: {
    "total:number": { verified: true, absent: false, exact: false, value: total },
    "vendor:string": { verified: false, value: "draft" },
  },
});

type Change = {
  workspaceId: string;
  documentId: string;
  revision: number | null;
  deleted: boolean;
  occurredAt: string;
};

async function harness({ open }: { open?: LocalSourceFileStore["open"] } = {}) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "evaluation-documents-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const database = new Database(":memory:");
  cleanups.push(() => database.close());
  const verificationLinks: string[] = [];

  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: ORIGIN,
    database,
    mailSink: {
      capture: async (message) => {
        const link = message.text.match(/https?:\/\/\S+/)?.[0];

        if (link) verificationLinks.push(link);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  const workspaceControl = createLocalWorkspaceControl(database);
  const productStoreRegistry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(productStoreRegistry.closeAll);
  const operations = createLocalWorkspaceProductOperations();
  const files = createLocalSourceFileStore({ stateDirectory });
  const sourceFileStore: LocalSourceFileStore = open ? { ...files, open } : files;
  // Mutable so a test can change installation settings between requests, as a restart would.
  const sourceStorage: LocalSourceStorageConfiguration = { provider: "local", originalRetentionEnabled: true };
  const changes: Change[] = [];

  const library = createLocalEvaluationDocuments({
    auth,
    workspaceControl,
    productStoreRegistry,
    operations,
    sourceFileStore,
    sourceStorage,
    stateDirectory,
    maxSourceFileBytes: 1024 * 1024,
    liveUpdateHub: {
      broadcastEvaluationDocument: (workspaceId, change) => {
        changes.push({ workspaceId, ...change });
      },
    },
  });

  const application = createLocalApplication({
    auth,
    workspaceControl,
    stateDirectory,
    sourceFileStore,
    sourceStorage,
    productStoreRegistry,
    workspaceProductOperations: operations,
    evaluationDocuments: library,
  });

  const signUp = (email: string, name: string) =>
    createSignedInUser({ application, auth, email, name, verificationLinks });

  const owner = await signUp("ada@example.com", "Ada Lovelace");
  const member = await signUp("grace@example.com", "Grace Hopper");
  const stranger = await signUp("linus@example.com", "Linus Torvalds");
  const workspace = workspaceControl.listAcceptedWorkspaces({ userId: owner.session.id })[0]!;

  const invitation = workspaceControl.createInvitation({
    workspaceId: workspace.id,
    inviterUserId: owner.session.id,
    email: member.session.email,
  });

  workspaceControl.acceptInvitation({
    invitationId: invitation.id,
    userId: member.session.id,
    userEmail: member.session.email,
  });

  type User = { cookie: string };

  const call = (user: User | null, path = "", init: RequestInit & { workspaceId?: string } = {}) => {
    const headers = new Headers(init.headers);

    if (user) headers.set("cookie", user.cookie);

    if (!headers.has("x-workspace-id")) headers.set("x-workspace-id", init.workspaceId ?? workspace.id);

    if (init.method && init.method !== "GET" && init.method !== "HEAD" && !headers.has("origin"))
      headers.set("origin", ORIGIN);

    return application(new Request(`${ORIGIN}/v1/evaluations/documents${path}`, { ...init, headers }));
  };

  const saveForm = ({
    operationId = crypto.randomUUID(),
    name = "Invoice March",
    answers = reference(),
    bytes = new Uint8Array([137, 80, 78, 71]),
    fileName = "invoice.png",
    type = "image/png",
  }: {
    operationId?: string;
    name?: string;
    answers?: ReturnType<typeof reference>;
    bytes?: Uint8Array;
    fileName?: string;
    type?: string;
  } = {}) => {
    const form = new FormData();
    form.set("document", new File([new Uint8Array(bytes)], fileName, { type }));
    form.set("metadata", JSON.stringify({ operation_id: operationId, name, reference: answers }));

    return form;
  };

  const save = (user: User, options: Parameters<typeof saveForm>[0] = {}, headers: HeadersInit = {}) =>
    call(user, "", { method: "POST", body: saveForm(options), headers });

  const saved = async (user: User = owner, options: Parameters<typeof saveForm>[0] = {}) => {
    const response = await save(user, options);
    expect(response.status).toBe(201);

    return await readDocumentResponse(response);
  };

  const patch = (user: User, id: string, body: JsonValue, headers: HeadersInit = {}) =>
    call(user, `/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });

  const libraryFiles = async () =>
    (await readdir(join(stateDirectory, "source-files"), { recursive: true }).catch(() => new Array<string>()))
      .map(String)
      .filter((name) => /source\.[a-z]+$/.test(name));

  return {
    stateDirectory,
    workspaceControl,
    library,
    sourceStorage,
    changes,
    owner,
    member,
    stranger,
    workspace,
    call,
    save,
    saved,
    saveForm,
    patch,
    libraryFiles,
    productStoreRegistry,
  };
}

test("an accepted member saves, lists, reads and downloads a Workspace entry with private no-store responses", async () => {
  const h = await harness();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  const bytes = new Uint8Array(await pdf.save());
  const created = await h.save(h.owner, { bytes, fileName: "März invoice.pdf", type: "application/pdf" });
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("private, no-store");
  const { document, reference: stored } = await readDocumentResponse(created);
  const documentId = document.id;
  expect(document).toMatchObject({
    id: expect.stringMatching(/^evd_[0-9a-f]{32}$/),
    name: "Invoice March",
    source_name: "März invoice.pdf",
    mime_type: "application/pdf",
    byte_size: bytes.byteLength,
    page_count: 2,
    revision: 1,
    updated_by_name: "Ada Lovelace",
    fields: [
      { identity: "total:number", name: "Total", data_type: "number", verified: true },
      { identity: "vendor:string", name: "Vendor", data_type: "string", verified: false },
    ],
  });
  // Zero stays zero and the unverified draft stays unverified.
  expect(stored).toEqual(reference(0));
  expect(await h.libraryFiles()).toEqual([
    `workspaces/${h.workspace.id}/evaluation-documents/${documentId}/source.pdf`,
  ]);
  expect(h.changes).toEqual([
    { workspaceId: h.workspace.id, documentId, revision: 1, deleted: false, occurredAt: expect.any(String) },
  ]);

  const listed = await h.call(h.member);
  expect(listed.headers.get("cache-control")).toBe("private, no-store");
  expect(await listed.json()).toEqual({ documents: [document], next_cursor: null });
  const read = await h.call(h.member, `/${documentId}`);
  expect(await read.json()).toEqual({ document, reference: reference(0) });

  const download = await h.call(h.member, `/${documentId}/source`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/pdf");
  expect(download.headers.get("content-disposition")).toBe(
    `attachment; filename="M_rz invoice.pdf"; filename*=UTF-8''${encodeURIComponent("März invoice.pdf")}`,
  );
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  expect(download.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(bytes));
  const head = await h.call(h.member, `/${documentId}/source`, { method: "HEAD" });
  expect(head.headers.get("content-length")).toBe(String(bytes.byteLength));
});

test("API keys, missing sessions, other Workspaces, departed members and untrusted origins are refused before any data is exposed", async () => {
  const h = await harness();
  const { document } = await h.saved(h.member);
  const apiKey = h.workspaceControl.rotateApiKey({ workspaceId: h.workspace.id, userId: h.owner.session.id }).api_key;
  const strangerWorkspace = h.workspaceControl.listAcceptedWorkspaces({ userId: h.stranger.session.id })[0]!;

  const refusals: Array<[Response, string]> = [
    [await h.call(null, `/${document.id}`), "workspace_access_denied"],
    [
      await h.call(null, `/${document.id}/source`, { headers: { authorization: `Bearer ${apiKey}` } }),
      "session_required",
    ],
    [await h.call(h.owner, `/${document.id}`, { headers: { authorization: `Bearer ${apiKey}` } }), "session_required"],
    [await h.save(h.owner, {}, { authorization: `Bearer ${apiKey}` }), "session_required"],
    [await h.call(h.stranger, `/${document.id}`), "workspace_access_denied"],
    // Membership of another Workspace grants nothing here, and its header cannot reach this entry.
    [await h.call(h.owner, `/${document.id}`, { workspaceId: strangerWorkspace.id }), "workspace_access_denied"],
    [await h.save(h.owner, {}, { origin: "http://evil.test" }), "untrusted_origin"],
    [
      await h.patch(h.owner, document.id, { expected_revision: 1, name: "Hijacked" }, { origin: "http://evil.test" }),
      "untrusted_origin",
    ],
    [
      await h.call(h.owner, `/${document.id}`, { method: "DELETE", headers: { origin: "http://evil.test" } }),
      "untrusted_origin",
    ],
  ];

  for (const [response, code] of refusals) {
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
  }

  // The creator leaves: the entry stays with the Workspace, and the departed member loses access.
  h.workspaceControl.leaveWorkspace({ workspaceId: h.workspace.id, userId: h.member.session.id });
  expect((await h.call(h.member, `/${document.id}`)).status).toBe(403);
  expect((await h.call(h.member, `/${document.id}/source`)).status).toBe(403);
  expect((await h.patch(h.member, document.id, { expected_revision: 1, name: "Mine" })).status).toBe(403);
  expect((await h.call(h.member, `/${document.id}`, { method: "DELETE" })).status).toBe(403);
  const kept = await readDocumentResponse(await h.call(h.owner, `/${document.id}`));
  expect(kept.document).toMatchObject({ name: "Invoice March", revision: 1 });
  expect((await h.call(h.owner)).status).toBe(200);
  expect(await h.libraryFiles()).toHaveLength(1);
});

test("another member renames, updates and deletes a shared entry with conditional revisions", async () => {
  const h = await harness();
  const { document } = await h.saved(h.owner);
  const renamed = await h.patch(h.member, document.id, { expected_revision: 1, name: "  Supplier March  " });
  expect(renamed.status).toBe(200);
  const afterRename = await readDocumentResponse(renamed);
  expect(afterRename.document).toMatchObject({ name: "Supplier March", revision: 2, updated_by_name: "Grace Hopper" });
  // A rename never touches the Expected answer set.
  expect(afterRename.reference).toEqual(reference(0));

  // An answer update against the revision loaded before the rename is refused with the current state.
  const stale = await h.patch(h.owner, document.id, { expected_revision: 1, reference: reference(12) });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    error: { code: "revision_conflict", message: expect.any(String) },
    current: { document: afterRename.document, reference: reference(0) },
  });
  const replaced = await h.patch(h.owner, document.id, { expected_revision: 2, reference: reference(12) });
  expect(replaced.status).toBe(200);
  expect(await replaced.json()).toMatchObject({
    document: { name: "Supplier March", revision: 3, updated_by_name: "Ada Lovelace" },
    reference: reference(12),
  });
  // Replace with mine, reviewed against revision 2, conflicts again once someone else wrote revision 3.
  expect((await h.patch(h.member, document.id, { expected_revision: 2, name: "Again" })).status).toBe(409);

  for (const body of [
    { expected_revision: 3 },
    { expected_revision: 0, name: "x" },
    { expected_revision: 3, name: "" },
    { expected_revision: 3, name: "ok", extra: 1 },
    { expected_revision: 3, reference: { ...reference(), candidates: [] } },
  ]) {
    expect((await h.patch(h.owner, document.id, body)).status).toBe(400);
  }

  expect((await h.call(h.member, `/${document.id}`, { method: "DELETE" })).status).toBe(204);
  expect(h.changes.at(-1)).toMatchObject({
    workspaceId: h.workspace.id,
    documentId: document.id,
    revision: null,
    deleted: true,
  });
  expect(await h.libraryFiles()).toEqual([]);

  for (const response of [
    await h.call(h.owner, `/${document.id}`),
    await h.call(h.owner, `/${document.id}/source`),
    await h.patch(h.owner, document.id, { expected_revision: 3, name: "Resurrected" }),
    await h.call(h.owner, `/${document.id}`, { method: "DELETE" }),
  ]) {
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "document_not_found" } });
  }

  expect(await (await h.call(h.owner)).json()).toEqual({ documents: [], next_cursor: null });
});

test("a retried save returns the committed entry, a changed payload conflicts, and a deleted entry is never recreated", async () => {
  const h = await harness();
  const operationId = "save_7f3a";
  const first = await h.saved(h.owner, { operationId });
  // The response was lost; the tab retries the same operation.
  const replay = await h.save(h.owner, { operationId });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(first);
  // Another member retrying the same payload recovers the same entry rather than a duplicate.
  expect((await h.save(h.member, { operationId })).status).toBe(200);

  for (const changed of [
    { name: "Other" },
    { answers: reference(1) },
    { bytes: new Uint8Array([1, 2, 3]) },
    { fileName: "renamed.png" },
  ]) {
    const conflict = await h.save(h.owner, { operationId, ...changed });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "operation_conflict" } });
  }

  expect((await readObjectResponse(await h.call(h.owner))).documents).toHaveLength(1);
  expect(await h.libraryFiles()).toHaveLength(1);

  expect((await h.call(h.owner, `/${first.document.id}`, { method: "DELETE" })).status).toBe(204);
  const deleted = await h.save(h.owner, { operationId });
  expect(deleted.status).toBe(410);
  expect(await deleted.json()).toMatchObject({ error: { code: "document_deleted" } });
  expect(await (await h.call(h.owner)).json()).toEqual({ documents: [], next_cursor: null });
  expect(await h.libraryFiles()).toEqual([]);
  // Temporary uploads of replayed and rejected saves are all released.
  expect(await readdir(join(h.stateDirectory, "temporary", "evaluation-documents"))).toEqual([]);

  // Receipts hold only identities and a digest: no document name, answers or file content.
  const lease = h.productStoreRegistry.acquire({ workspaceId: h.workspace.id, mode: "existing" })!;

  try {
    expect(lease.store.getEvaluationDocumentSaveReceipt(operationId)).toEqual({
      operation_id: operationId,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      document_id: first.document.id,
      outcome: "deleted",
    });
  } finally {
    lease.release();
  }
});

test("without effective retention new saves are refused while existing entries stay readable and editable", async () => {
  const h = await harness();
  const { document } = await h.saved(h.owner);
  const status = async () => (await h.call(h.member, "/status")).json();
  expect(await status()).toEqual({ save_available: true, reason: null });

  const refusedWith = async (reason: string) => {
    expect(await status()).toEqual({ save_available: false, reason });
    const refused = await h.save(h.member);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: "save_unavailable", message: expect.any(String), reason } });
    expect((await h.call(h.member, `/${document.id}/source`)).status).toBe(200);
    const current = (await readDocumentResponse(await h.call(h.member, `/${document.id}`))).document.revision;
    expect(
      (await h.patch(h.member, document.id, { expected_revision: current, reference: reference(current) })).status,
    ).toBe(200);
  };

  h.workspaceControl.setWorkspaceSourceRetention({
    workspaceId: h.workspace.id,
    userId: h.owner.session.id,
    disabled: true,
  });
  await refusedWith("workspace_opted_out");
  h.workspaceControl.setWorkspaceSourceRetention({
    workspaceId: h.workspace.id,
    userId: h.owner.session.id,
    disabled: false,
  });
  h.sourceStorage.originalRetentionEnabled = false;
  await refusedWith("retention_disabled");
  h.sourceStorage.provider = "none";
  await refusedWith("storage_unconfigured");
  expect((await readObjectResponse(await h.call(h.owner))).documents).toHaveLength(1);
  expect(await h.libraryFiles()).toHaveLength(1);
});

test("the library pages newest-updated first with opaque cursors bound to the name search", async () => {
  const h = await harness();
  const ids: string[] = [];

  // Distinct update times keep the expected order independent of the ID tie-break.
  for (const name of ["Alpha invoice", "Beta receipt", "Gamma invoice"]) {
    ids.push((await h.saved(h.owner, { name })).document.id);
    await Bun.sleep(3);
  }

  // Renaming the oldest entry makes it the most recently updated.
  expect((await h.patch(h.owner, ids[0]!, { expected_revision: 1, name: "Alpha invoice v2" })).status).toBe(200);

  const page = async (query: string) => {
    const payload = await readObjectResponse(await h.call(h.member, query));
    const documents = jsonArray(payload.documents).map(evaluationDocument);
    const next_cursor = payload.next_cursor === null ? null : jsonText(payload.next_cursor);

    return { ...payload, documents, next_cursor };
  };

  const first = await page("?limit=2");
  expect(first.documents.map((document) => document.id)).toEqual([ids[0], ids[2]]);
  const second = await page(`?limit=2&cursor=${first.next_cursor}`);
  expect(second).toEqual({ documents: [expect.objectContaining({ id: ids[1] })], next_cursor: null });

  const invoices = await page("?q=INVOICE&limit=1");
  expect(invoices.documents.map((document) => document.id)).toEqual([ids[0]]);
  expect(
    (await page(`?q=invoice&limit=1&cursor=${invoices.next_cursor}`)).documents.map((document) => document.id),
  ).toEqual([ids[2]]);
  expect((await page("?q=receipt.png")).documents).toEqual([]);
  expect((await page("?q=invoice.png")).documents).toHaveLength(3);

  for (const query of [
    "?cursor=not-a-cursor",
    `?cursor=${invoices.next_cursor}`,
    "?limit=0",
    "?limit=101",
    "?limit=two",
  ]) {
    const response = await h.call(h.member, query);
    expect(response.status).toBe(400);
  }
});

test("a missing original is distinguished from temporarily unreachable storage without losing the entry", async () => {
  let failOpen = false;
  const files: Pick<LocalSourceFileStore, "open"> = {};

  const h = await harness({
    open: async (key) => {
      if (failOpen) throw new Error("EIO");

      return files.open!(key);
    },
  });

  files.open = createLocalSourceFileStore({ stateDirectory: h.stateDirectory }).open;
  const { document } = await h.saved(h.owner);

  failOpen = true;
  const unavailable = await h.call(h.owner, `/${document.id}/source`);
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("retry-after")).toBe("5");
  expect(await unavailable.json()).toMatchObject({ error: { code: "source_unavailable" } });
  expect(
    await h.library.sources.copyToTemporary({
      workspaceId: h.workspace.id,
      documentId: document.id,
      maxBytes: 1024,
      destinationPath: join(h.stateDirectory, "temporary", "evaluations", "copy.upload"),
      signal: new AbortController().signal,
    }),
  ).toEqual({ ok: false, reason: "unavailable" });

  failOpen = false;
  await rm(join(h.stateDirectory, "source-files", "workspaces", h.workspace.id, "evaluation-documents", document.id), {
    recursive: true,
  });
  const missing = await h.call(h.owner, `/${document.id}/source`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "source_missing" } });
  // HEAD has no body, so availability checks read the code from a header.
  const missingHead = await h.call(h.owner, `/${document.id}/source`, { method: "HEAD" });
  expect([missingHead.status, missingHead.headers.get("x-error-code")]).toEqual([404, "source_missing"]);
  expect((await h.call(h.owner, `/${document.id}`)).status).toBe(200);
});

test("the temporary runner copies saved originals only while the entry exists", async () => {
  const h = await harness();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const { document } = await h.saved(h.owner, { bytes, fileName: "scan.png" });
  const input = { workspaceId: h.workspace.id, documentId: document.id, signal: new AbortController().signal };
  const destination = (name: string) => join(h.stateDirectory, "temporary", "evaluations", name);
  await Bun.write(destination(".keep"), "");
  expect(h.library.sources.exists(input)).toBe(true);
  expect(
    await h.library.sources.copyToTemporary({ ...input, destinationPath: destination("copy.upload"), maxBytes: 1024 }),
  ).toEqual({ ok: true, mimeType: "image/png", size: bytes.byteLength, name: "scan.png" });
  expect(new Uint8Array(await Bun.file(destination("copy.upload")).arrayBuffer())).toEqual(bytes);
  // The processing bound applies to saved originals too.
  expect(
    await h.library.sources.copyToTemporary({ ...input, destinationPath: destination("small.upload"), maxBytes: 4 }),
  ).toEqual({ ok: false, reason: "too_large" });
  expect(await Bun.file(destination("small.upload")).exists()).toBe(false);
  await expect(
    h.library.sources.copyToTemporary({
      ...input,
      destinationPath: join(h.stateDirectory, "outside.upload"),
      maxBytes: 1024,
    }),
  ).rejects.toThrow();

  expect((await h.call(h.owner, `/${document.id}`, { method: "DELETE" })).status).toBe(204);
  expect(h.library.sources.exists(input)).toBe(false);
  expect(
    await h.library.sources.copyToTemporary({ ...input, destinationPath: destination("late.upload"), maxBytes: 1024 }),
  ).toEqual({ ok: false, reason: "not_found" });
  // Deleting the library original leaves a working copy already handed to processing.
  expect(await Bun.file(destination("copy.upload")).exists()).toBe(true);
  expect(h.library.sources.exists({ workspaceId: "workspace_without_data", documentId: document.id })).toBe(false);
});

test("invalid saves are rejected without creating an entry or keeping an upload", async () => {
  const h = await harness();

  const invalid = async (form: FormData, code: string) => {
    const response = await h.call(h.owner, "", { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code } });
  };

  const withMetadata = (metadata: JsonValue) => {
    const form = h.saveForm();
    form.set("metadata", isString(metadata) ? metadata : JSON.stringify(metadata));

    return form;
  };

  await invalid(withMetadata("{"), "invalid_evaluation_document");
  await invalid(
    withMetadata({ operation_id: "has space", name: "x", reference: reference() }),
    "invalid_evaluation_document",
  );
  await invalid(withMetadata({ operation_id: "op", name: " ", reference: reference() }), "invalid_evaluation_document");
  await invalid(
    withMetadata({ operation_id: "op", name: "x", reference: reference(), results: [] }),
    "invalid_evaluation_document",
  );
  await invalid(withMetadata({ operation_id: "op", name: "x", reference: reference("twelve") }), "invalid_reference");
  const noFile = new FormData();
  noFile.set("metadata", JSON.stringify({ operation_id: "op", name: "x", reference: reference() }));
  await invalid(noFile, "invalid_document");
  await invalid(h.saveForm({ type: "text/plain", fileName: "notes.txt" }), "invalid_document");
  expect(await (await h.call(h.owner)).json()).toEqual({ documents: [], next_cursor: null });
  expect(await h.libraryFiles()).toEqual([]);
  expect(await readdir(join(h.stateDirectory, "temporary", "evaluation-documents"))).toEqual([]);
});
