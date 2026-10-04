# Code quality rules

`bun run lint` runs ESLint and the vendored [anti-slop rules](../../tools/oxlint/anti-slop/UPSTREAM.md). Both are required by CI. Run `bun run lint:anti-slop --fix` to apply the spacing rule, then review the diff and rerun lint.

- Preserve known types. Use domain contracts for internal code and parse untrusted input at boundaries. JSON inputs use `shared/json.ts`; checking that a value is JSON does not validate its domain contract.
- Runtime representation checks belong in typed guard functions. Avoid ad hoc `typeof` checks throughout business logic.
- Use typed dependency seams in tests. Do not replace whole modules or cast incomplete test doubles to complete services.
- Prefer typed SQLite query results and explicit narrowing over assertions. A necessary non-const assertion needs a nearby `SAFETY:` comment stating the actual invariant that makes it valid.
- Preserve omission semantics when constructing optional fields. Assign optional properties conditionally; do not replace omitted fields with `undefined` unless the receiving contract treats them identically.
- Avoid adjacent eager array filtering/mapping and growing accumulator copies. Review callback ordering and filtering behavior when combining passes.
- Keep blank lines around declarations and control-flow boundaries as enforced by the spacing rule.

The complete executable policy is in `oxlint.config.ts`. Fix the contract or boundary when a rule reports a problem; do not bypass it with broad casts, blanket disables or unsupported safety claims.
