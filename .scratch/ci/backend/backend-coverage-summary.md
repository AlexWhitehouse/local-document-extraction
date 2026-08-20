# Backend coverage evidence

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Deterministic test seed: 9140001
- Test exit code: 0
- Coverage gate: PASS

| Metric | Hit / found | Current | Checked baseline |
| --- | ---: | ---: | ---: |
| Lines | 6159 / 6886 | 89.44% | 89.40% |
| Functions | 615 / 682 | 90.18% | 90.00% |

## Production modules absent from LCOV (3)

- `src/lib/types.ts`
- `src/migrate.ts`
- `src/server.ts`

The baseline is read-only during test execution. Raising it requires a reviewed edit to `backend/coverage-baseline.json`; lower measured coverage fails this command.
