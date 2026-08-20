# Ticket 14 deliberate browser failure evidence

The terminal result locator was temporarily changed from `INV-E2E-001` to
`INV-E2E-FAILURE-PROBE`, then the full `bunx bun@1.4.0 run test:e2e` lane was
run. The test failed with exit code 1 after 15 seconds at the intended UI
assertion. The passing assertion was restored immediately afterward.

The failed result directory contained:

- `trace.zip` (2,543,562 bytes)
- `browser-final-state-*.png` (115,801 bytes)
- `browser-console-*.json`
- `network-metadata-*.json`
- `workspace-live-frames-*.json`
- Playwright `error-context.md`

The three JSON attachments were scanned for bearer/authorization/cookie,
password/secret/token, the synthetic account email, source filename, and fake
extraction answer; no match was found. The test's `finally` block also completed
the child harness shutdown and asserted that its temporary state directory no
longer existed before Playwright reported the intended failure.
