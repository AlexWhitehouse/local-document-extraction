# Concepts

**Workspace:** A shared space that holds templates, documents, jobs, members, API keys, and model settings. Everything you do happens inside a Workspace.

**Template:** A reusable description of the fields to extract from a kind of document, each with a name, a description, and a data type.

**Template tag:** A user-defined, lowercase label shared across a Workspace and reusable on multiple templates. Tags organize templates and define the candidate pool for automatic selection without changing extraction fields or versions.

**Document:** One logical document, submitted as a PDF or image or identified as a page group within an uploaded PDF.

**Document packet:** A PDF submitted with Smart splitting enabled. It owns the original file, split plan, and zero or more child extraction jobs. The UI shows an accepted one-document packet as an ordinary document, while the API retains the packet.

**Smart splitting:** The Workspace-controlled identification of logical documents within a PDF, with optional verified blank-page exclusion. It runs before field extraction.

**Automatic template selection:** Choosing a suitable template for a document from templates matching any supplied tag, using candidate names and descriptions. An explicit template choice bypasses this step.

**Extraction job:** The record of one document being processed, including its status and, once completed, its results.

**Model gateway:** The AI service, remote or local, that a Workspace uses for Extraction, Document classification & splitting, and Template assistant model roles.

**Workspace API key:** A secret that lets scripts use one Workspace's templates, documents, and jobs without a browser sign-in.
