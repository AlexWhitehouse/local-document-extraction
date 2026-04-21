CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  rate_limit_per_minute INTEGER,
  max_templates INTEGER,
  max_fields_per_template INTEGER,
  max_image_bytes INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_api_key_hash ON tenants(api_key_hash);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant_status ON templates(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_templates_tenant_deleted ON templates(tenant_id, deleted_at);

CREATE TABLE IF NOT EXISTS template_fields (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  field_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  PRIMARY KEY (template_id, version, field_id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE INDEX IF NOT EXISTS idx_template_fields_template_version ON template_fields(template_id, version, position);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  image_r2_key TEXT,
  image_mime_type TEXT,
  image_deleted_at TEXT,
  model_name TEXT,
  ai_gateway_route TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_created ON jobs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs(tenant_id, status);

CREATE TABLE IF NOT EXISTS job_results (
  job_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer_json TEXT,
  normalized_value TEXT,
  confidence REAL,
  evidence_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, field_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_results_job_id ON job_results(job_id);
