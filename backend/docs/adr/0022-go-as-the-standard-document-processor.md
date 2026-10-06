# Go as the standard document processor

Status: implemented. Supersedes the opt-in rollout in ADR-0019 and experimental
intake/result handoffs in ADR-0021. Older-version downgrade compatibility is not required.

Go is the only background engine for smart splitting, automatic Template selection
and extraction. Bun retains authentication, public APIs, upload acceptance, domain
validation, authoritative SQLite transactions and interactive Template/evaluation APIs.
Rendering still uses the pinned PDF.js/Bun workers to preserve extraction quality.

The Bun extraction runner now owns only recovery and Workspace leases. Its duplicate
extraction, routing and split orchestration is removed. Tests of adapter/domain rules
use controlled responses through the same production adapter; normal backend tests
also run the real Go processor. There is no selectable Bun fallback.

The Go intake and result-normalization prototypes did not improve measured throughput.
Their endpoints, feature flags, duplicate normalizer, prepared-row SQL path and fixture
generator are removed. Historical benchmark evidence remains labeled as historical.

Normal build/dev/test commands build the processor. Startup requires it and reports
a missing binary rather than accepting work with no engine. Release archives bundle
Linux/macOS x64/ARM64 binaries; source builds require the Go version in go.mod. The
GO_PROCESSOR_BINARY setting overrides a path, not the processing architecture.

Local concurrency always derives from CPU/RAM unless explicitly overridden. Provider
concurrency remains independently bounded. Source publication barriers, exact rendered
pixels, shared page reuse and response/artifact budgets remain enabled. No migration
or downgrade tooling for older versions is included.
