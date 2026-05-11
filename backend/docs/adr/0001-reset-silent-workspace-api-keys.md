# Reset Silent Workspace API Keys

Existing Workspaces may have `api_key_hash` values created automatically during Workspace creation or first-login bootstrap, but those secrets were not explicit external-client credentials and cannot be recovered for one-time display. We will treat those silently generated hashes as no user-generated **Workspace API key** during migration, clearing/resetting them so owners/admins explicitly issue a new key before external API clients can authenticate.
