DROP INDEX IF EXISTS idx_workspaces_api_key_hash;

ALTER TABLE workspaces DROP COLUMN api_key_hash;
ALTER TABLE workspaces ADD COLUMN api_key_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_api_key_hash
  ON workspaces(api_key_hash)
  WHERE api_key_hash IS NOT NULL;
