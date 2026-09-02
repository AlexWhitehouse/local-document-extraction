# Workspace-Owned Model Configuration

Each Workspace owns a complete-or-absent Model gateway configuration in its product
database. Owners/admins configure it through the frontend using session-only product
APIs; members see presence only. We deliberately reject global defaults, environment
inheritance, and profile configuration so a Workspace never sends Documents using
another Workspace's implicit endpoint or credentials. This supersedes the global
configuration and managed-file parts of ADR-0004.

Credentials use versioned authenticated encryption bound to the Workspace, with a
dedicated random machine-local secret separate from authentication secrets. This
keeps local installation self-contained rather than requiring an external vault;
full backups are therefore secret-bearing and must preserve both ciphertext and
the machine secret. Missing/unreadable credentials preserve configuration and fail
closed, while explicit replacement or clear remains possible. Revision counters
survive clear/recreate to reject stale mutations without retaining credential history.

Admission checks readiness before Source/job side effects. Each claimed attempt
uses a current in-memory snapshot, which can finish despite later changes. Future
queued/retry attempts use the latest configuration at the existing scheduled time.
The optional connection test is a single minimal chat-completions request, not
capability certification; saving is independent of the gateway. No request follows
redirects or uses managed-file uploads. Existing Workspace data is migrated lazily
without importing legacy configuration, fallback, dual writes, or rollback support.
