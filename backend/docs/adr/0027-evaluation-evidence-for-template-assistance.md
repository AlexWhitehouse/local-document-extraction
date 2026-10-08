# Evaluation Evidence for Template Assistance

Template assistance previously took only a completed Extraction job and a sample as evidence. Its prompt said that no Evaluation takes place and that results are not ground truth. Evaluations hold the one thing assistance lacked: answers a user has verified. This decision lets an Evaluation candidate's failing fields reach the assistant without making Evaluation results durable. It extends [Saved Evaluation Document Originals](0014-saved-evaluation-document-originals.md) and [Temporary Evaluation Result Cache](0015-temporary-evaluation-result-cache.md) and changes neither.

## Decision

- **Evidence kind.** `POST /v1/templates/assist` accepts an `evaluation` object (`shared/evaluationEvidence.ts`). It lists one candidate's failing fields per document: field identity, the candidate's value, the verified Expected answer, absence, the `Mismatch` verdict and, for tables, mismatched cells and missing or extra rows. It also names the candidate's model, Template and overall accuracy. It needs no job and no binary source, and it can't be combined with a job.
- **Verified answers only.** The browser scores with the existing client-side rules, so unverified answers are never scored and never sent. Every failure must carry `expected_verified: true` and `verdict: "Mismatch"`. The server can't check verification itself, because working copies live in the tab; it rejects any other shape.
- **Budget.** The browser caps values at 1,000 characters, documents at 50, failures at 100 per document and cells at 40 per table. It then removes failures from the end until the evidence fits 128 KiB, and records what it left out. The server re-validates every property and rejects evidence over 128 KiB rather than truncating it.
- **Ground truth for this kind only.** When evaluation evidence is present, the system prompt adds rules that treat verified Expected answers as ground truth for their documents. Candidate values and stored job results remain model output. The model can cite failing fields with `{scope:"evaluation",fieldId}`.
- **Optional original.** The browser may attach one failing document's original as the sample: the upload already in the tab, or a library original downloaded through the existing route. `sample_document` names it, and the server labels it `original_of_evaluation_document`. The server never reads the library for assistance.
- **Testing changes.** Assistance still doesn't run extraction or measure accuracy. In a template comparison, **Test changes** adds a copy of the candidate with the edited Template and runs it through the normal run path. The browser compares the copy with the original on the documents both ran. The original candidate is never edited by this flow, and the copy counts towards the limit of eight candidates.

## Consequences

- Verified Expected answers and candidate values from the tab are sent to the Workspace's Template assistant model, like a job's stored results. Nothing new is stored: evidence, proposals and comparisons end with the tab, as ADR 0015 requires.
- A request built from very large batches can omit failures. The panel states how many were left out.
- Model comparisons share one Template across candidates, so they get the assistant but not **Test changes**.
