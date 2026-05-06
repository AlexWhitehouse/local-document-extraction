# Context Map

## Contexts

- [Backend](./backend/CONTEXT.md) - owns durable product rules, workspace access decisions, extraction APIs, and background image processing.
- [Frontend](./frontend/CONTEXT.md) - owns UI language, workspace selection presentation, local browser state, and user-facing interaction feedback.

## Relationships

- **Frontend -> Backend**: Frontend calls `/api/auth/*` for authentication and `/v1/*` for workspace-scoped product APIs.
- **Backend -> Frontend**: Backend serves the built frontend assets in production for non-`/v1` `GET` and `HEAD` requests.
- **Frontend <-> Backend**: **Workspace context** is selected and displayed by the frontend, but accepted access and invitation lifecycle rules are owned by the backend.
