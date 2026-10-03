# Workspace-Owned Model Configuration

Each Workspace owns its Model gateway configuration in its product database. The configuration is complete or absent. Owners and admins configure it in the frontend. Members can see only whether a configuration exists.

The application does not use global defaults, inherited environment values, or profile configuration. A Workspace cannot silently use another Workspace's endpoint or credentials. This decision replaces the global configuration and managed-file decisions in ADR-0004.

Credentials use versioned authenticated encryption bound to the Workspace. A dedicated random secret stays on the local machine, separate from authentication secrets. The installation does not require an external vault. Complete backups contain secrets and must keep both the encrypted credentials and the machine secret.

If credentials are missing or unreadable, the application keeps the configuration but refuses model access. An owner or admin can still replace or clear the configuration. Revision counters survive clear and recreate actions. They reject stale changes without keeping credential history.

Admission verifies model readiness before it stores a Source or creates a job. Each claimed attempt uses a current snapshot in memory. That attempt can finish after settings change. Later queued attempts and retries use the latest configuration at their scheduled time.

The optional connection test sends one minimal chat-completions request. It does not verify model capabilities. Saving configuration does not contact the gateway. Requests do not follow redirects or use managed-file uploads.

The application migrates existing Workspace data when needed. It does not import legacy configuration or provide fallback, dual writes, or rollback support.
