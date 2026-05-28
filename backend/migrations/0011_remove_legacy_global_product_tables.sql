DROP INDEX IF EXISTS idx_job_results_job_id;
DROP TABLE IF EXISTS job_results;

DROP INDEX IF EXISTS idx_jobs_workspace_status_attempt;
DROP INDEX IF EXISTS idx_jobs_workspace_created;
DROP INDEX IF EXISTS idx_jobs_workspace_status;
DROP TABLE IF EXISTS jobs;

DROP INDEX IF EXISTS idx_template_fields_template_version;
DROP TABLE IF EXISTS template_fields;

DROP INDEX IF EXISTS idx_templates_workspace_status;
DROP INDEX IF EXISTS idx_templates_workspace_deleted;
DROP TABLE IF EXISTS templates;
