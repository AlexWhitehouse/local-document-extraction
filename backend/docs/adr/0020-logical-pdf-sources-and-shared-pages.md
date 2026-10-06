# Logical PDF sources and shared rendered pages

Status: implemented for locally stored split children in the Go processor.

This revises ADR-0016's requirement for an independent physical PDF per child.
A child still owns exactly its accepted page selection and receives independent
classification and extraction calls. Prompts, schemas, page resolution, split
validation, blank verification, accounting and reassessment limits are unchanged.
No combined packet extraction or lossy image substitution is introduced.

A local child Source file may be a versioned `source.view` manifest plus a sibling
`source.backing.pdf` hard link to the immutable packet bytes. The manifest records
physical pages and source identity. It is written, synced, and renamed before
child publication; its directory is synced before the SQLite commit. The existing
reserved-slot cleanup intent covers both files. A crash can retry a reserved child
without changing its identity. An accepted child remains readable after packet
source cleanup because the filesystem link independently owns those bytes.

The Source file store resolves a view for Go into a backing path and page selection.
For downloads, previews, Template assistance, the Bun reference processor, or other
consumers of `open`/`read`, it materializes precisely that view as a PDF using the
existing guarded page copier. Go only copies pages when a model accepts PDF input;
rendered requests select original pages directly. Existing physical sources remain
readable. Rolling back to older application code that predates views requires
materializing them first; switching between the current Bun and Go engines works.

S3-retained packet children retain the existing eager derived-PDF publication path.
Their remote object ownership and manifest reconciliation are unchanged. Sharing
remote originals would require a separate durable reference/retention protocol.

Go retains rendered packet pages in a bounded filesystem cache, scoped by Workspace,
immutable source identity, file size/mtime and physical page. A child takes hard
links into its private run directory; concurrent eviction cannot invalidate a
provider upload. There is no content-hash reuse between independent submissions.
Normal child completion removes shared entries. Unused exclusions are removed at
handoff; failed parents remove their entries. Abandoned entries expire after one
minute without use, swept every five seconds. Process shutdown removes the cache;
startup removes orphaned temporary directories from dead supervisors. Cached pixels
are disposable and never the recovery authority.

The cache receives at most one third of the configured prepared-artifact allowance,
capped at 512 MiB. The remaining allowance continues to reserve worst-case active
PDF output. Readers conservatively charge their run's links as well. There is no
unbounded disk cache or reduction in source-size/response limits.

PDF admission inspectors and Go PDF workers receive private file paths in
bounded messages, rather than copies of source bytes across pipes.
Workers retain independent process isolation, file-size validation, parser limits,
deadlines and recycling. The public API never accepts a filesystem path.

Opaque pages whose decoded RGB components are all equal use lossless 8-bit
grayscale PNG. Colored or transparent pages use RGBA. This selects an exact PNG
representation without quantization, resolution changes, or altered pixels.

The durable adapter batches classification assessment/binding and split
assessment/plan acceptance. A successful model response carries its usage receipt
in the same adapter request; usage and validated stage completion share a commit.
Invalid results still record usage before the existing retry/hold policy applies. Group commits collect up to 64 mutations or four
milliseconds, retain FULL synchronous durability, and acknowledge only after commit.
The SQLite statement cache holds up to 128 distinct statements instead of twenty,
avoiding compilation churn across admission, accounting and processing queries.

Final extraction releases prepared files and their disk-byte credits after HTTP
request upload completes, independently of the provider response. A synchronized
one-time release joins the network trace callback before response processing or
retry. Durable sources remain until completion. Classification retains prepared
images for extraction. HTTP/2/race tests hold the provider response blocked while
verifying that artifact bytes are released and the durable source still exists.

See [source-view benchmarks](../../../backend-go/SOURCE-VIEW-BENCHMARKS.md).
