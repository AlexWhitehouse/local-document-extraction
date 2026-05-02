ALTER TABLE jobs ADD COLUMN workflow_instance_id TEXT;
ALTER TABLE jobs ADD COLUMN workflow_started_at TEXT;
ALTER TABLE jobs ADD COLUMN current_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN completed_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN last_failed_attempt INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status_attempt ON jobs(workspace_id, status, current_attempt);
