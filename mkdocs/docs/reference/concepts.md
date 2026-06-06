# Concepts

## Workspace

A Workspace is the boundary for product data, member access, Templates, Documents, Extraction jobs, API keys, and billing.

## Workspace Context

Workspace context is the currently selected accepted Workspace or pending invitation. Accepted Workspace context enables product API access. Pending invitation context only enables invitation actions.

## Template

A Template is a reusable extraction schema. Templates contain typed fields and may contain table-shaped object fields for repeated rows.

## Document

A Document is a user-provided PDF or image Source file submitted for extraction.

## Extraction Job

An Extraction job is the asynchronous processing record created after a Document submission. It stores status, attempt counters, errors, and completed Extraction results.

## Source File

The Source file is the original uploaded binary. It is stored while the job needs it and is removed when the job is deleted.

## Credit

A Credit is a prepaid unit that allows one billable Document page to be submitted. PDF pages count individually; image Documents count as one page.

## Workspace API Key

A Workspace API key is an opaque external-client credential scoped to one Workspace. It is separate from the browser session and is not used by the Studio as its own auth mode.

