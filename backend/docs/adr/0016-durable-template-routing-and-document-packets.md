# Durable template routing and document packets

Automatic template selection delays Template binding until document assessment. Smart splitting creates a packet that owns its original separately from child extraction jobs. These states remain durable in the existing Workspace queue. An interruption cannot silently repeat model decisions, change page boundaries, lose a held source, or create duplicate children.

Submissions require an explicit Template ID or nonempty canonical tags. An explicit ID fixes the Template version at acceptance. Otherwise, Templates that match any supplied tag form the complete candidate pool. Classification receives only the document and candidate IDs, names, and descriptions.

The stored candidate snapshot also records the current version and tag membership. Automatic binding revalidates that snapshot atomically before fixing the version. An empty or unsuitable candidate pool never expands silently. Authorized manual resolution can select another usable Template.

Splitting and blank exclusion are authoritative Workspace settings. Both default to disabled, and accepted work captures their values. Exclusion runs only as part of splitting. Every selected physical page must belong to a group or an explicit exclusion.

PDFs uploaded with exactly one page bypass both splitting and blank exclusion and create an ordinary Extraction job. There is no page boundary to assess, and a blank single-page upload follows normal extraction. Eligibility uses the uploaded file's page count before page selection: a multi-page original still follows Workspace settings when only one page is selected. Automatic template selection remains independent.

Automatic blank exclusion requires independent verification that finds no extracted text, annotations, or nonwhite rendered pixels. An all-blank packet completes without child jobs. Manual review requires the current revision. The server must still verify an empty manual plan.

Each split decision and each child's classification gets one initial assessment and at most two targeted reassessments. Used rounds survive restarts and configuration changes. Transport retries have separate limits. The Document classification & splitting role inherits Extraction unless explicitly configured. It uses the Workspace gateway, credential, capability flags, and sequential policy. Final field extraction uses Extraction.

Committed plans and Template bindings survive extraction retries. A committed plan reserves stable child identities before materialization. Each child owns an independent derived PDF and original-page map. Native PDF and rendered-image requests therefore contain only that child's pages.

Child deletion leaves a tombstone. Packet deletion prevents delayed work from creating children. Packet S3 originals have a separate manifest owner kind. Cleanup and recovery remain independent across control and product databases.

Held work keeps required sources regardless of completed-original retention. Failed packets use the existing failed-source grace period. A terminal materialization failure records cleanup intents for abandoned reserved artifacts and preserves accepted children.

This extends durable scheduling in ADR-0006/0009 and Workspace configuration in ADR-0008. It also extends shared preparation memory in ADR-0010, guarded PDF parsing in ADR-0012, and retention ownership in ADR-0013.

PDF subset creation starts after memory and sequencing admission. Child creation holds a shared reservation until derived files are stored. Worst-case reservations decrease to actual artifact sizes after materialization, before model transport or file persistence. Materialization and preview processes have deadlines that permit cancellation. They also limit source size, output size, and concurrency. Limit failures produce actionable holds or errors. They never silently truncate pages or candidates.

The implementation uses bounded direct assessment. It does not use an OCR index, full extraction against every candidate, or unlimited reassessment. Model decision quality still requires assessment with representative documents.

PDF materialization uses a pool of four isolated processes with a bounded queue (now PDFium workers; see [ADR-0025](0025-pdfium-as-the-only-pdf-engine.md)). Each process handles at most 32 operations or 64 MiB of source input, retires at 128 MiB sampled RSS or after an error, and exits after five seconds idle. Allocation guards reset for every operation. Copying pages does not load PDF.js or canvas; rendering dependencies load only for preview and blank verification. Local PDF capacity rejection retries only that PDF operation, within a 60-second retry window and with cancellation, without repeating a model call or consuming another assessment round. Parser and output limit errors remain terminal.
