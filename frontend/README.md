# Frontend

The frontend is a React single-page app built with Vite. In normal use the Bun server serves the built app together with the API, at http://127.0.0.1:8787:

```bash
bun run build
bun run start
```

For frontend work, run the Bun server and the Vite dev server in two terminals:

```bash
bun run dev            # Bun server, restarts on backend changes
bun run dev:frontend   # Vite, with hot reload, at http://127.0.0.1:5173
```

Vite forwards `/api/auth` and `/v1` requests to the Bun server. It uses `PORT` from the root `.env`, or `DEV_API_ORIGIN` if set.

## Layout

| Path | What's there |
| --- | --- |
| `src/main.jsx` | Entry point. |
| `src/ApplicationBootstrap.jsx` | Loads the public configuration from `/v1/config` before rendering the app. |
| `src/App.jsx` | App shell: session, Workspace selection, and page switching. |
| `src/features/` | One folder per area: `auth`, `workspaces`, `templates`, `documents`, `evaluations`, `admin`, `onboarding`, and so on. |
| `src/lib/` | Shared code: the auth client, Workspace selection, caches, toast messages. |

`frontend/CONTEXT.md` defines the UI terms the code and copy use.

## Tests

```bash
bun run test            # all frontend tests (Vitest + Testing Library)
bun run test:coverage   # the same, checked against coverage-baseline.json
```

Run both from `frontend/`, or use `bun run test` from the root to include the backend. The coverage floor in `coverage-baseline.json` only changes when someone deliberately edits it.

## Workspace model settings

The **Model gateway** section of the Workspace page is the most stateful part of the UI, so here is how it behaves:

- A new Workspace starts with no model. The section header shows its status; there's no separate banner.
- Only owners and admins can edit it. Members can only see whether a model is set up.
- The model credential is separate from the Workspace API key, and it's write-only. Leave the credential blank when editing to keep the saved one, or type a new one to replace it. Clearing the whole configuration asks for confirmation.
- Extraction is the default for the optional Template assistant and Document classification & splitting roles. Each override has its own direct-PDF and structured-output capabilities on the shared gateway. All capability switches start off.
- **Test connection** tests the current draft and never saves it. **Save** doesn't contact the gateway. Editing any field clears the previous test result.
- Switching Workspace or signing out clears any unsaved credential. Responses that arrive after a switch are ignored.
- When another browser changes the settings, a live update makes this one reload them. If someone else saved in the meantime, your save is rejected and you're asked to reload, rather than overwriting their change.

## Document processing and packets

**Document processing** appears below Model gateway on the Workspace page. Its Smart splitting and blank-exclusion switches save immediately, show outcome toasts, and restore their previous value if saving fails. The upload modal uses these settings without displaying a policy paragraph or offering overrides. Automatic selection uses existing tag chips with a preview of matching Templates; browser uploads submit all pages.

The backend always returns a packet for a PDF accepted with Smart splitting enabled. The frontend presents a one-page upload or an accepted one-document plan as an ordinary Document, without packet tabs or a duplicate row. Multi-document and unresolved plans retain the packet view. This decision follows the accepted plan, not the number of surviving children after deletion. Deleting a single-document presentation removes its hidden parent too; downloading and exporting use the child Document.
