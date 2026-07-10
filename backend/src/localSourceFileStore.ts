import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type LocalSourceFileStore = {
  delete(sourceFileKey: string): Promise<void>;
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

  return {
    delete: async (sourceFileKey) => {
      await rm(pathForKey(rootDirectory, sourceFileKey), { force: true });
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
  const pathRelativeToRoot = relative(rootDirectory, path);
  if (!pathRelativeToRoot || pathRelativeToRoot.startsWith("..")) {
    throw new Error("Source file key is outside local Source file storage.");
  }
  return path;
}
