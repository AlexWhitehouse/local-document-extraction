import type { Database } from "bun:sqlite";
import { HttpError } from "./lib/http";

export type WorkspaceDocumentProcessingSettings = {
  enable_smart_splitting: boolean;
  exclude_blank_pages: boolean;
};

export const DEFAULT_DOCUMENT_PROCESSING_SETTINGS: Readonly<WorkspaceDocumentProcessingSettings> = Object.freeze({
  enable_smart_splitting: false,
  exclude_blank_pages: false,
});

/** Added by the Workspace product migration; missing settings keep existing upload behavior. */
export const DOCUMENT_PROCESSING_SETTINGS_SCHEMA = `
  CREATE TABLE workspace_document_processing_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    enable_smart_splitting INTEGER NOT NULL DEFAULT 0 CHECK (enable_smart_splitting IN (0, 1)),
    exclude_blank_pages INTEGER NOT NULL DEFAULT 0 CHECK (exclude_blank_pages IN (0, 1))
  );
`;

export function validateDocumentProcessingSettings(value: unknown): WorkspaceDocumentProcessingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidSettings();
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "enable_smart_splitting" && key !== "exclude_blank_pages")
    || typeof settings.enable_smart_splitting !== "boolean" || typeof settings.exclude_blank_pages !== "boolean") throw invalidSettings();
  return { enable_smart_splitting: settings.enable_smart_splitting, exclude_blank_pages: settings.exclude_blank_pages };
}

function invalidSettings() {
  return new HttpError(400, "invalid_document_processing_settings", "Provide enable_smart_splitting and exclude_blank_pages as true or false.");
}

/** Capture at acceptance: blank-page removal is part of splitting, never an independent stage. */
export function effectiveDocumentProcessingPolicy(settings: WorkspaceDocumentProcessingSettings): WorkspaceDocumentProcessingSettings {
  return { enable_smart_splitting: settings.enable_smart_splitting, exclude_blank_pages: settings.enable_smart_splitting && settings.exclude_blank_pages };
}

export function createWorkspaceDocumentProcessingSettingsStore(database: Database) {
  return {
    getDocumentProcessingSettings(): WorkspaceDocumentProcessingSettings {
      const row = database.query("SELECT enable_smart_splitting, exclude_blank_pages FROM workspace_document_processing_settings WHERE singleton = 1").get() as { enable_smart_splitting: number; exclude_blank_pages: number } | null;
      return row ? { enable_smart_splitting: Boolean(row.enable_smart_splitting), exclude_blank_pages: Boolean(row.exclude_blank_pages) } : { ...DEFAULT_DOCUMENT_PROCESSING_SETTINGS };
    },
    putDocumentProcessingSettings(input: WorkspaceDocumentProcessingSettings): WorkspaceDocumentProcessingSettings {
      const settings = validateDocumentProcessingSettings(input);
      database.query(`INSERT INTO workspace_document_processing_settings (singleton, enable_smart_splitting, exclude_blank_pages)
        VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET
        enable_smart_splitting = excluded.enable_smart_splitting, exclude_blank_pages = excluded.exclude_blank_pages`).run(Number(settings.enable_smart_splitting), Number(settings.exclude_blank_pages));
      return settings;
    },
  };
}
