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

  return {
    delete: async (sourceFileKey) => {
      const path = pathForKey(rootDirectory, sourceFileKey);
      await rm(path, { force: true });

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
    open: async (sourceFileKey) => {
      const file = Bun.file(pathForKey(rootDirectory, sourceFileKey));

      return (await file.exists()) ? file : null;
    },
    promoteTemporary: async ({ workspaceId, jobId, mimeType, temporaryPath }) => {
      const sourceFileKey = newSourceFileKey(workspaceId, jobId, mimeType);
      assertPathWithinRoot(temporaryDirectory, temporaryPath, "Temporary Source file");
      const destination = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporaryPath, destination);

      return sourceFileKey;
    },
    read: async (sourceFileKey) => readFile(pathForKey(rootDirectory, sourceFileKey)).catch(() => null),
    write: async ({ workspaceId, jobId, mimeType, bytes }) => {
      const sourceFileKey = newSourceFileKey(workspaceId, jobId, mimeType);
      const path = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(bytes));

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
