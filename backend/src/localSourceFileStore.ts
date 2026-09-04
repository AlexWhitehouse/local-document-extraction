import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type LocalSourceFileStore = {
  delete(sourceFileKey: string): Promise<void>;
  eraseWorkspace(workspaceId: string): Promise<void>;
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

  return {
    delete: async (sourceFileKey) => {
      const path = pathForKey(rootDirectory, sourceFileKey);
      await rm(path, { force: true });
      // Only remove an empty job directory, never recursively erase siblings.
      if (/^workspaces\/[a-zA-Z0-9_-]+\/jobs\/[a-zA-Z0-9_-]+\/source\.[a-z]+$/.test(sourceFileKey)) {
        await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
        });
      }
    },
    eraseWorkspace: async (workspaceId) => {
      assertIdentifier(workspaceId, "Workspace ID");
      await rm(resolve(rootDirectory, "workspaces", workspaceId), { recursive: true, force: true });
    },
    open: async (sourceFileKey) => {
      const file = Bun.file(pathForKey(rootDirectory, sourceFileKey));
      return await file.exists() ? file : null;
    },
    promoteTemporary: async ({ workspaceId, jobId, mimeType, temporaryPath }) => {
      assertIdentifier(workspaceId, "Workspace ID");
      assertIdentifier(jobId, "Extraction job ID");
      const extension = EXTENSION_BY_MIME_TYPE[mimeType];
      if (!extension) throw new Error("Unsupported Source file MIME type");
      assertPathWithinRoot(temporaryDirectory, temporaryPath, "Temporary Source file");
      const sourceFileKey = `workspaces/${workspaceId}/jobs/${jobId}/source.${extension}`;
      const destination = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(destination), { recursive: true });
      await rename(temporaryPath, destination);
      return sourceFileKey;
    },
    read: async (sourceFileKey) => readFile(pathForKey(rootDirectory, sourceFileKey)).catch(() => null),
    write: async ({ workspaceId, jobId, mimeType, bytes }) => {
      assertIdentifier(workspaceId, "Workspace ID");
      assertIdentifier(jobId, "Extraction job ID");
      const extension = EXTENSION_BY_MIME_TYPE[mimeType];
      if (!extension) {
        throw new Error("Unsupported Source file MIME type");
      }

      const sourceFileKey = `workspaces/${workspaceId}/jobs/${jobId}/source.${extension}`;
      const path = pathForKey(rootDirectory, sourceFileKey);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(bytes));
      return sourceFileKey;
    },
  };
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
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
