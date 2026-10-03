# Concepts

**Workspace:** A shared space for templates, documents, jobs, members, API keys, and model settings. All work occurs within a Workspace.

**Template:** A reusable field definition for a document type. Each field has a name, extraction instructions, and a data type.

**Template tag:** A user-defined lowercase label shared within a Workspace. A tag can apply to multiple templates. Tags organize templates and define automatic-selection candidates without changing fields or versions.

**Document:** One logical document. It can be an uploaded PDF or image, or a page group identified within a PDF.

**Document packet:** A PDF accepted with Smart splitting enabled. It owns the original file, split plan, and zero or more child extraction jobs. The frontend presents an accepted one-document packet as an ordinary document. The API preserves its packet identity.

**Smart splitting:** A Workspace setting that identifies logical documents within a PDF before field extraction. It can optionally exclude verified blank pages.

**Automatic template selection:** Selection of a template from candidates matching any supplied tag. The model uses candidate names and descriptions. An explicit template choice bypasses selection.

**Extraction job:** A processing record for one document. It includes status and, after completion, results.

**Model gateway:** The local or remote AI service used by a Workspace. Its model roles are Extraction, Document classification & splitting, and Template assistant.

**Workspace API key:** A secret that lets scripts access one Workspace’s templates, documents, and jobs without browser sign-in.
