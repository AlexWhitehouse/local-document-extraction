# Frontend

The frontend is a React single-page app built with Vite. In normal use, the Bun server serves the built app and API at http://127.0.0.1:8787.

```bash
bun run build
bun run start
```

For frontend development, run the Bun and Vite servers in separate terminals:

```bash
bun run dev            # Bun server, restarts on backend changes
bun run dev:frontend   # Vite, with hot reload, at http://127.0.0.1:5173
```

Vite forwards `/api/auth` and `/v1` requests to the Bun server. It uses `PORT` from the root `.env`. If `DEV_API_ORIGIN` is set, it uses that value instead.

## Layout

| Path | Contents |
| --- | --- |
| `src/main.jsx` | Frontend entry point. |
| `src/ApplicationBootstrap.jsx` | Loads public configuration from `/v1/config` before displaying the app. |
| `src/App.jsx` | App shell for the session, Workspace selection, and page changes. |
| `src/features/` | Feature folders, including `auth`, `workspaces`, `templates`, `documents`, `evaluations`, `admin`, and `onboarding`. |
| `src/lib/` | Shared authentication, Workspace selection, caches, and notification code. |

`frontend/CONTEXT.md` defines the UI terms for code and documentation.

## Tests

```bash
bun run test            # all frontend tests (Vitest + Testing Library)
bun run test:coverage   # the same, checked against coverage-baseline.json
```

Run these commands from `frontend/`. To include backend tests, run `bun run test` from the root. The coverage floor in `coverage-baseline.json` changes only through an explicit edit.

## Workspace model settings

The Workspace page's **Model gateway** section has these rules:

- A new Workspace has no model. The section header shows this status. There is no separate banner.
- Only owners and admins can edit settings. Members can see whether a model is configured.
- The model credential is separate from the Workspace API key. The browser cannot read a saved credential. To keep it, leave the credential field empty during an edit. To replace it, enter a new value. Clearing the complete configuration requires confirmation.
- Optional Template assistant and Document classification & splitting roles use Extraction by default. Each override can set its own direct-PDF and structured-output capabilities. The gateway remains shared. All capability switches default to off.
- **Test connection** tests the draft without saving it. **Save** does not contact the gateway. A field edit clears the previous test result.
- A Workspace change or sign-out clears unsaved credentials. The browser ignores responses that arrive after the change.
- A change in another browser triggers a live update and reload. If another user saved first, the app rejects your stale save. Reload the settings before trying again.

## Document processing and packets

**Document processing** appears below Model gateway on the Workspace page. Smart splitting and blank-exclusion switches save immediately. Notifications show the result. If saving fails, the switch returns to its previous value.

The upload modal uses these settings without additional policy text or overrides. Automatic selection uses existing tag chips and a preview of matching Templates. Browser uploads include all pages.

The backend returns a packet for every PDF accepted with Smart splitting enabled. The frontend displays a one-page upload or accepted one-document plan as an ordinary Document. This view has no packet tabs or duplicate row. Multi-document and unresolved plans use the packet view.

The accepted plan determines the view. The number of remaining children after deletion does not change it. Deleting a Document shown as one upload also deletes its hidden parent. Downloads and exports use the child Document.
