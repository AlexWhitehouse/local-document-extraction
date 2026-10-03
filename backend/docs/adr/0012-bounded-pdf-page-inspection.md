# Bounded PDF page inspection

Source size limits compressed input. It does not limit the memory needed to decode a PDF. Previously, page counting loaded the PDF in the API process before model preparation admission. A small compressed object stream could use much more memory than its upload reservation. This could block every Workspace.

Document submission and Template generation now inspect page counts in disposable Bun subprocesses. The runtime limits concurrent inspections and queued requests. Timeout or cancellation terminates the child and waits for its exit before releasing the permit.

The parser applies limits before it allocates decoded buffers or expands structures. These limits cover object streams, cross-reference streams, and page-tree traversal.

The installed pdf-lib version has no public decompression budget. The isolated inspector therefore verifies and loads a specific CommonJS implementation. It guards allocation points in that decoder and parser. These guards exist only in the short-lived child.

Failed compatibility checks stop inspection. A dependency upgrade requires review of these allocation points and passing compressed-stream and structural-limit regression tests. Parser recovery must not ignore a limit breach.

This design combines allocation limits in the guarded parser with a process that can be terminated. It does not guarantee a portable operating-system RSS ceiling. Bun worker memory options and sampled memory-pressure controls cannot provide that guarantee.

PDF.js rendering remains a separate stage under ADR-0010's model preparation policy. This decision covers admission and page counting. It does not replace Source-size, image, or model-payload limits.

Limit failures return product errors without sensitive details. They leave no accepted job or promoted Source file. Parser saturation is retryable. The public result remains a page count. API clients do not receive parser internals, document content, or subprocess diagnostics.
