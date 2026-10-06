import { publishSourceFile } from "./localSourcePublication";
import { readPdfSourceView, writePdfSourceView, deletePdfSourceView, type LocalPdfSourceView } from "./localPdfSourceView";
import { materializePdfPages, validatePdfPageSelection } from "./lib/pdfPageOperations";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const EXTENSION_BY_MIME_TYPE = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export type LocalEvaluationDocumentDirectory = {
  workspaceId: string;
  documentId: string;
  /** The original in the directory, or null when a save was interrupted before it landed. */
  sourceFileKey: string | null;
  modifiedAtMs: number;
};

export type LocalSourceFileStore = {
  delete(sourceFileKey: string): Promise<void>;
  resolveProcessingSource?(sourceFileKey: string): Promise<{ path: string; pages?: number[]; identity: string }>;
  createPdfView?(input: { workspaceId: string; jobId: string; sourceFileKey: string; pages: number[] }): Promise<string>;
  eraseWorkspace(workspaceId: string): Promise<void>;
  /** Moves a library save's own upload into its Saved Evaluation document directory. */
  promoteEvaluationDocument?(input: {
    workspaceId: string;
    documentId: string;
    mimeType: string;
    temporaryPath: string;
  }): Promise<string>;
  /** Library directories in a stable order, starting after `after` (`<workspaceId>/<documentId>`), so sweeps can resume. */
  listEvaluationDocumentDirectories?(input: {
    limit: number;
    after?: string | null;
  }): Promise<LocalEvaluationDocumentDirectory[]>;
  deleteEvaluationDocumentDirectory?(input: { workspaceId: string; documentId: string }): Promise<void>;
  open?(sourceFileKey: string): Promise<Blob | null>;
  promoteTemporary?(input: {
    workspaceId: string;
    jobId: string;
    mimeType: string;
    temporaryPath: string;
  }): Promise<string>;
  read(sourceFileKey: string): Promise<Uint8Array | null>;
  write(input: {
    workspaceId: string;
    jobId: string;
    mimeType: string;
    bytes: ArrayBuffer | Uint8Array;
  }): Promise<string>;
};

export function createLocalSourceFileStore({ stateDirectory }: { stateDirectory: string }): LocalSourceFileStore {
  const rootDirectory = resolve(stateDirectory, "source-files");
  const temporaryDirectory = resolve(stateDirectory, "temporary", "submissions");
  const libraryTemporaryDirectory = resolve(stateDirectory, "temporary", "evaluation-documents");

  const openSource = async (sourceFileKey: string): Promise<Blob | null> => {
    const path = pathForKey(rootDirectory, sourceFileKey);
    const file = Bun.file(path);

    if (!await file.exists()) return null;
    const view = await readPdfSourceView(path);

    if (!view) return file;
    const bytes = await materializePdfPages(Bun.file(view.path), view.pages);

    return new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  };

  return {
    resolveProcessingSource: async (sourceFileKey) => {
      const path = pathForKey(rootDirectory, sourceFileKey);

      return await readPdfSourceView(path) ?? { path, identity: sourceFileKey };
    },
    createPdfView: async ({ workspaceId, jobId, sourceFileKey, pages }) => {
      const destinationKey = newSourceFileKey(workspaceId, jobId, "application/pdf").replace(/pdf$/, "view");

      if (!sourceFileKey.startsWith(`workspaces/${workspaceId}/`)) throw new Error("Source view must stay within its Workspace");
      const path = pathForKey(rootDirectory, sourceFileKey);
      const prior = await readPdfSourceView(path);
      const selected = validatePdfPageSelection(pages, prior?.pages.length ?? 10_000);
      const source: LocalPdfSourceView = { path: prior?.path ?? path, identity: prior?.identity ?? sourceFileKey, pages: prior ? selected.map((page) => prior.pages[page - 1]!) : selected };
      await writePdfSourceView(pathForKey(rootDirectory, destinationKey), source);

      return destinationKey;
    },
    delete: async (sourceFileKey) => {
      const path = pathForKey(rootDirectory, sourceFileKey);

      if (sourceFileKey.endsWith("/source.view")) await deletePdfSourceView(path);
      else await rm(path, { force: true });

      // Only remove an empty owner directory, never recursively erase siblings.
      if (
        /^workspaces\/[a-zA-Z0-9_-]+\/(?:jobs|evaluation-documents)\/[a-zA-Z0-9_-]+\/source\.[a-z]+$/.test(
          sourceFileKey,
        )
      ) {
        await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
        });
      }
    },
    eraseWorkspace: async (workspaceId) => {
      assertIdentifier(workspaceId, "Workspace ID");
      await rm(resolve(rootDirectory, "workspaces", workspaceId), { recursive: true, force: true });
    },
    promoteEvaluationDocument: async ({ workspaceId, documentId, mimeType, temporaryPath }) => {
      const sourceFileKey = ownedSourceFileKey(workspaceId, "evaluation-documents", documentId, mimeType);
      assertPathWithinRoot(libraryTemporaryDirectory, temporaryPath, "Temporary Evaluation document");
      const destination = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporaryPath, destination);
      await publishSourceFile(destination).catch(async (error) => { await rm(destination, { force: true }).catch(() => {}); throw error; });

      return sourceFileKey;
    },
    listEvaluationDocumentDirectories: async ({ limit, after = null }) => {
      const directories: LocalEvaluationDocumentDirectory[] = [];
      const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

      const workspaces = (
        await readdir(resolve(rootDirectory, "workspaces"), { withFileTypes: true }).catch(() => [])
      ).sort(byName);

      for (const workspace of workspaces) {
        if (!workspace.isDirectory() || !IDENTIFIER.test(workspace.name)) continue;

        if (after && workspace.name < after.split("/")[0]!) continue;
        const parent = resolve(rootDirectory, "workspaces", workspace.name, "evaluation-documents");

        for (const document of (await readdir(parent, { withFileTypes: true }).catch(() => [])).sort(byName)) {
          if (directories.length >= limit) return directories;

          if (!document.isDirectory() || !IDENTIFIER.test(document.name)) continue;

          if (after && `${workspace.name}/${document.name}` <= after) continue;
          const directory = resolve(parent, document.name);

          const source = (await readdir(directory).catch((): string[] => [])).find((name) =>
            /^source\.[a-z]+$/.test(name),
          );

          const modified = await stat(source ? resolve(directory, source) : directory).catch(() => null);

          if (!modified) continue;
          directories.push({
            workspaceId: workspace.name,
            documentId: document.name,
            sourceFileKey: source
              ? `workspaces/${workspace.name}/evaluation-documents/${document.name}/${source}`
              : null,
            modifiedAtMs: modified.mtimeMs,
          });
        }
      }

      return directories;
    },
    deleteEvaluationDocumentDirectory: async ({ workspaceId, documentId }) => {
      assertIdentifier(workspaceId, "Workspace ID");
      assertIdentifier(documentId, "Evaluation document ID");
      await rm(resolve(rootDirectory, "workspaces", workspaceId, "evaluation-documents", documentId), {
        recursive: true,
        force: true,
      });
    },
    open: openSource,
    promoteTemporary: async ({ workspaceId, jobId, mimeType, temporaryPath }) => {
      const sourceFileKey = newSourceFileKey(workspaceId, jobId, mimeType);
      assertPathWithinRoot(temporaryDirectory, temporaryPath, "Temporary Source file");
      const destination = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporaryPath, destination);
      await publishSourceFile(destination).catch(async (error) => { await rm(destination, { force: true }).catch(() => {}); throw error; });

      return sourceFileKey;
    },
    read: async (sourceFileKey) => {
      if (!sourceFileKey.endsWith("/source.view")) return readFile(pathForKey(rootDirectory, sourceFileKey)).catch(() => null);
      const source = await openSource(sourceFileKey);

      return source ? new Uint8Array(await source.arrayBuffer()) : null;
    },
    write: async ({ workspaceId, jobId, mimeType, bytes }) => {
      const sourceFileKey = newSourceFileKey(workspaceId, jobId, mimeType);
      const path = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(bytes));
      await publishSourceFile(path).catch(async (error) => { await rm(path, { force: true }).catch(() => {}); throw error; });

      return sourceFileKey;
    },
  };
}

const IDENTIFIER = /^[a-zA-Z0-9_-]+$/;

function newSourceFileKey(workspaceId: string, jobId: string, mimeType: string): string {
  return ownedSourceFileKey(workspaceId, "jobs", jobId, mimeType);
}

function ownedSourceFileKey(
  workspaceId: string,
  owners: "jobs" | "evaluation-documents",
  ownerId: string,
  mimeType: string,
): string {
  assertIdentifier(workspaceId, "Workspace ID");
  assertIdentifier(ownerId, owners === "jobs" ? "Extraction job ID" : "Evaluation document ID");
  const extension = EXTENSION_BY_MIME_TYPE.get(mimeType);

  if (!extension) throw new Error("Unsupported Source file MIME type");

  return `workspaces/${workspaceId}/${owners}/${ownerId}/source.${extension}`;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`${label} contains unsupported characters for local Source file storage.`);
  }
}

function pathForKey(rootDirectory: string, sourceFileKey: string): string {
  const path = resolve(rootDirectory, sourceFileKey);
  assertPathWithinRoot(rootDirectory, path, "Source file key");

  return path;
}

function assertPathWithinRoot(rootDirectory: string, path: string, label: string): void {
  const pathRelativeToRoot = relative(rootDirectory, resolve(path));

  if (!pathRelativeToRoot || pathRelativeToRoot.startsWith("..")) {
    throw new Error(`${label} is outside local Source file storage.`);
  }
}
