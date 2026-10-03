# Domain Docs

Use these instructions when engineering skills read the repository's domain documentation.

## Layout

The repository has multiple contexts. If `CONTEXT-MAP.md` exists at the root, read it first. It links to the relevant `CONTEXT.md` files.

## Before exploring, read these

- The root `CONTEXT-MAP.md`, if present. Then read each mapped `CONTEXT.md` relevant to the task.
- Relevant system decisions in `docs/adr/`.
- Relevant context decisions in locations such as `src/<context>/docs/adr/`, `backend/docs/adr/`, or `frontend/docs/adr/`.

If a file is absent, continue without comment. Do not report its absence or propose creating it in advance. The `/grill-with-docs` producer skill creates these files when terms or decisions are resolved.

## File structure

A repository with multiple contexts uses this structure:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          # system-wide decisions
├── backend/
│   ├── CONTEXT.md
│   └── docs/adr/                      # backend-specific decisions
└── frontend/
    ├── CONTEXT.md
    └── docs/adr/                      # frontend-specific decisions
```

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` whenever you name a domain concept. This applies to issue titles, refactor proposals, hypotheses, and test names. Do not use synonyms that the glossary excludes.

If a required concept is absent, first reconsider whether the project uses that concept. If the glossary has a real gap, record it for `/grill-with-docs`.

## Flag ADR conflicts

If your proposal conflicts with an existing ADR, state the conflict and explain why the decision needs review. Do not silently replace it.

> This proposal conflicts with ADR-0007 (event-sourced orders). Reopen the decision because...
