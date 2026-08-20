# Bun package hygiene

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Policy: non-mutating production audit, dedupe check, and license inventory; no automatic fixes or updates.

| Check | Result |
| --- | ---: |
| Production advisories | 0 |
| Removable compatible duplicates | 0 |
| Production packages inventoried | 214 |
| License expressions | 15 |

## Dedupe output

```text
bun dedupe v1.4.0 (34cbb9a40)
🎉 No duplicates — checked 392 packages, every one already resolves to a single version [3.00ms]
```

Artifacts are generated from the installed frozen graph. Audit and dedupe failures are reported but never repaired automatically.
