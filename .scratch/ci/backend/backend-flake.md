# Backend flake-lane evidence

- Runtime: Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676)
- Platform: darwin arm64
- Seed: 90909
- Repetitions per test file: 1
- Exit code: 0
- Reproduce: `BUN_TEST_SEED=90909 BUN_TEST_RERUNS=1 bun run --cwd backend test:bun:flake`

## Test output

```text
bun test v1.4.0 (34cbb9a40) 2x PARALLEL


src/localAuth.bun.test.ts:
2026-08-20T16:41:13.105Z WARN [Better Auth]: Reset Password: User not found

 --seed=90909
 177 pass
 0 fail
 745 expect() calls
Ran 177 tests across 55 files. [3.88s]
```
