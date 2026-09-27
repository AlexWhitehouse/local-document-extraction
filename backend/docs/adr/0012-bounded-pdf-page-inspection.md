# Bounded PDF page inspection

Source size is a bound on compressed input, not on decoded PDF memory. Page
counting previously loaded the PDF inside the API process before model preparation
admission. A small compressed object stream could allocate far beyond its upload
reservation and block every Workspace.

Document submission and Template generation now inspect page counts in disposable
Bun subprocesses. Concurrent inspections and queued requests are bounded; timeout
or cancellation kills and reaps the child before releasing its permit. Parsing
uses limits checked before decoded-buffer allocation and structural expansion,
including object streams, cross-reference streams and page-tree traversal.

The installed pdf-lib version exposes no public decompression budget. The isolated
inspector therefore verifies and loads its specific CommonJS implementation and
guards its decoder/parser allocation seams. These guards are confined to the
short-lived child. Compatibility checks fail closed: a dependency upgrade must
review these seams and pass compressed-stream and structural-limit regressions
before it can be accepted. Parser recovery must not swallow a limit breach.

This combines a hard bound on the guarded parser allocations with a terminable
execution context. It does not claim a portable operating-system RSS ceiling;
Bun worker memory options and sampled memory pressure are insufficient for that
claim. PDF.js rendering remains a separate stage under the model preparation
policy in ADR-0010. This decision closes the admission/page-counting boundary and
does not replace the existing Source-size, image, or model-payload limits.

Limit failures are sanitized product errors and leave no accepted job or promoted
Source file. Parser saturation is retryable. The public interface remains a page
count; parser internals, document content and subprocess diagnostics are not sent
to API clients.
