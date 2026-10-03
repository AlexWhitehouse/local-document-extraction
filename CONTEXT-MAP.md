# Context Map

## Contexts

- [Backend](./backend/CONTEXT.md) - controls durable product rules, workspace access, extraction APIs, and background image processing.
- [Frontend](./frontend/CONTEXT.md) - controls UI language, Workspace selection display, local browser state, and action feedback.

## Relationships

- **Frontend -> Backend**: The frontend calls `/api/auth/*` for authentication. It calls `/v1/*` for Workspace-scoped product APIs.
- **Backend -> Frontend**: The Bun backend serves built frontend assets. It provides SPA fallback for `GET` and `HEAD` requests outside `/v1`.
- **Frontend <-> Backend**: The frontend selects and displays **Workspace context**. The backend controls accepted access and invitation lifecycle rules.
