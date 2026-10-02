import { withAuthorizedProductStore, handleRetainedSourceFileRead, errorResponse, httpErrorResponse, type ProductServices } from "./localApplication";
import type { DocumentPacket } from "./localDocumentProcessingStore";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import { validateSplitPlan, DocumentAssessmentValidationError } from "./consumer/documentAssessment";
import { renderPdfPagePreview, verifyPdfBlankPages, PdfPageSelectionError } from "./lib/pdfPageOperations";
import { HttpError } from "./lib/http";
import { PdfSourceFileCapacityError, PdfSourceFileLimitError, InvalidPdfSourceFileError } from "./lib/sourceFilePageCount";
import { nowIso } from "./lib/ids";
let activePacketSourceOperations = 0;
/** Public packet metadata excludes internal storage keys and model configuration snapshots. */
export function publicDocumentPacket(packet: DocumentPacket) {
    const { source_file_key: _source, child_slots: _slots, configuration_snapshot: _configuration, ...visible } = packet;
    return visible;
}
export async function handleDocumentProcessingRequest({ product, request, scheduleQueuedJob, liveUpdateHub }: {
    product: ProductServices;
    request: Request;
    scheduleQueuedJob: (job: LocalQueuedExtractionJob) => void | Promise<void>;
    liveUpdateHub?: LocalLiveUpdateHub;
}): Promise<Response> {
    const path = new URL(request.url).pathname;
    const packetMatch = path.match(/^\/v1\/packets(?:\/([^/]+)(?:\/(source|plan|pages\/([0-9]+)\/preview))?)?$/);
    const templateMatch = path.match(/^\/v1\/jobs\/([^/]+)\/template$/);
    const packetId = packetMatch?.[1] ? decodeURIComponent(packetMatch[1]) : null;
    const noStore = { "cache-control": "private, no-store" };
    if (packetId && packetMatch?.[2] === "source" && ["GET", "HEAD"].includes(request.method)) {
        return handleRetainedSourceFileRead({ product, request, jobId: packetId, packet: true });
    }
    return withAuthorizedProductStore(product, request, async ({ store, workspace, signal: workspaceSignal }) => {
        const signal = AbortSignal.any([workspaceSignal, request.signal]);
        try {
            if (templateMatch && request.method === "POST") {
                const jobId = decodeURIComponent(templateMatch[1]!);
                const body = await request.json() as {
                    template_id?: unknown;
                };
                if (typeof body?.template_id !== "string" || !body.template_id.trim())
                    throw new HttpError(400, "invalid_template_id", "Choose a valid template");
                if (!store.getExtractionJobSummary(jobId))
                    throw new HttpError(404, "not_found", "Document not found");
                if (!store.bindDocumentTemplate({ jobId, templateId: body.template_id.trim(), manual: true, updatedAt: nowIso() }))
                    throw new HttpError(409, "template_resolution_conflict", "This document is no longer awaiting a template, or the template is not available");
                const job = store.getExtractionJobSummary(jobId)!;
                liveUpdateHub?.broadcastJob(workspace.id, job);
                try {
                    await scheduleQueuedJob({ job_id: jobId, workspace_id: workspace.id, template_id: job.template_id, template_version: job.template_version, enqueued_at: nowIso(), attempt: job.current_attempt + 1 });
                }
                catch { /* Durable queued job recovery owns dispatch. */ }
                return Response.json({ ...job, results: [] }, { headers: noStore });
            }
            if (!packetMatch)
                throw new HttpError(404, "not_found", "Route not found");
            if (!packetId && request.method === "GET") {
                const cursorRaw = new URL(request.url).searchParams.get("cursor");
                let cursor: {
                    createdAt: string;
                    packetId: string;
                } | undefined;
                if (cursorRaw) {
                    try {
                        const parsed = JSON.parse(Buffer.from(cursorRaw, "base64url").toString());
                        if (typeof parsed.createdAt !== "string" || typeof parsed.packetId !== "string")
                            throw new Error();
                        cursor = parsed;
                    }
                    catch {
                        throw new HttpError(400, "invalid_cursor", "Invalid packet cursor");
                    }
                }
                const packets = store.listDocumentPackets({ limit: 51, cursor }), hasMore = packets.length > 50;
                const visible = packets.slice(0, 50), last = visible.at(-1);
                return Response.json({ packets: visible.map(publicDocumentPacket), has_more: hasMore, next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, packetId: last.packet_id })).toString("base64url") : null }, { headers: noStore });
            }
            const packet = packetId ? store.getDocumentPacket(packetId) : null;
            if (!packet || !packetId)
                throw new HttpError(404, "not_found", "Packet not found");
            if (packetMatch[3] && request.method === "GET") {
                const page = Number(packetMatch[3]);
                if (!packet.selected_pages.includes(page))
                    throw new HttpError(400, "invalid_page", "Choose an original selected page");
                return await withPacketSourceAdmission(async () => {
                    const sourceResponse = await handleRetainedSourceFileRead({ product, request, jobId: packetId, packet: true });
                    if (!sourceResponse.ok)
                        return sourceResponse;
                    const bytes = await boundedSourceResponse(sourceResponse, signal);
                    const png = await renderPdfPagePreview(bytes, page, signal);
                    return new Response(Uint8Array.from(png).buffer, { headers: { ...noStore, "content-type": "image/png", "x-content-type-options": "nosniff" } });
                });
            }
            if (packetMatch[2] === "plan" && request.method === "POST") {
                const body = await request.json() as {
                    revision?: unknown;
                    groups?: unknown;
                    exclusions?: unknown;
                };
                if (!body || !Number.isSafeInteger(body.revision))
                    throw new HttpError(400, "invalid_revision", "Provide the current plan revision");
                if (packet.plan_accepted || packet.status !== "awaiting_review" || packet.plan_revision !== body.revision)
                    throw new HttpError(409, "packet_plan_conflict", "The packet plan has changed; reload before saving");
                const groups = Array.isArray(body.groups) ? body.groups.map(group => group && typeof group === "object" ? (group as {
                    pages?: unknown;
                }).pages : null) : body.groups;
                // Verification flags come only from server pixel/text inspection, never the client.
                const exclusions = Array.isArray(body.exclusions) ? body.exclusions.map(exclusion => {
                    const item = exclusion as {
                        page?: unknown;
                        reason?: unknown;
                    };
                    return { page: item?.page, reason: item?.reason, verified_blank: false };
                }) : body.exclusions;
                let verifiedBlankPages: number[] | undefined;
                if (Array.isArray(groups) && groups.length === 0 && Array.isArray(exclusions) && packet.processing_policy.exclude_blank_pages) {
                    const verified = await withPacketSourceAdmission(async () => {
                        const sourceResponse = await handleRetainedSourceFileRead({ product, request, jobId: packetId, packet: true });
                        if (!sourceResponse.ok)
                            throw new HttpError(sourceResponse.status, "source_unavailable", "The packet source is unavailable");
                        const bytes = await boundedSourceResponse(sourceResponse, signal);
                        return verifyPdfBlankPages(bytes, packet.selected_pages, signal);
                    });
                    verifiedBlankPages = verified;
                    for (const exclusion of exclusions)
                        exclusion.verified_blank = verified.includes(exclusion.page as number);
                }
                const plan = validateSplitPlan(groups, exclusions, packet.selected_pages, packet.processing_policy.exclude_blank_pages, true);
                signal.throwIfAborted();
                const accepted = store.acceptDocumentPacketPlan({ packetId, revision: body.revision as number, ...plan, manual: true, verifiedBlankPages, updatedAt: nowIso() });
                if (!accepted)
                    throw new HttpError(409, "packet_plan_conflict", "The packet plan has changed; reload before saving");
                try {
                    await scheduleQueuedJob({ kind: "packet", job_id: packetId, workspace_id: workspace.id, template_id: packet.template_id, template_version: packet.template_version, enqueued_at: nowIso() });
                }
                catch { /* Recovery owns materialization of the accepted plan. */ }
                return Response.json(publicDocumentPacket(accepted), { headers: noStore });
            }
            if (!packetMatch[2] && request.method === "DELETE") {
                const owners = [packetId, ...packet.child_slots.map(slot => slot.job_id)], started: string[] = [];
                try {
                    for (const jobId of owners) {
                        await product.operations.beginDocumentDeletion({ workspaceId: workspace.id, jobId });
                        started.push(jobId);
                    }
                    const deleted = store.deleteDocumentPacket({ packetId });
                    if (!deleted)
                        throw new HttpError(404, "not_found", "Packet not found");
                    for (const source of deleted.sources) {
                        if (source.retained_object_key && !product.sourceObjects)
                            continue;
                        if (source.retained_object_key)
                            product.sourceObjects!.manifest.markDeleting({ objectKey: source.retained_object_key });
                        try {
                            await product.sourceFileStore.delete(source.source_file_key);
                            store.markSourceFileCleaned({ jobId: source.job_id, sourceFileKey: source.source_file_key, cleanedAt: nowIso() });
                        }
                        catch { /* The durable deletion intent is retried by retention cleanup. */ }
                    }
                    return Response.json({ deleted: true, packet_id: packetId }, { headers: noStore });
                }
                finally {
                    for (const jobId of started)
                        product.operations.completeDocumentDeletion({ workspaceId: workspace.id, jobId });
                }
            }
            if (!packetMatch[2] && request.method === "GET")
                return Response.json(publicDocumentPacket(packet), { headers: noStore });
            throw new HttpError(404, "not_found", "Route not found");
        }
        catch (error) {
            if (error instanceof HttpError)
                return httpErrorResponse(error);
            if (error instanceof PdfPageSelectionError || error instanceof InvalidPdfSourceFileError || error instanceof PdfSourceFileLimitError)
                return errorResponse(400, error.code, error.message, noStore);
            if (error instanceof PdfSourceFileCapacityError)
                return errorResponse(503, error.code, error.message, { ...noStore, "retry-after": "2" });
            if (error instanceof SyntaxError || error instanceof RangeError || error instanceof DocumentAssessmentValidationError)
                return errorResponse(400, "invalid_packet_plan", error.message, noStore);
            if (signal.aborted)
                return errorResponse(499, "document_processing_cancelled", "Request cancelled", noStore);
            return errorResponse(500, "document_processing_failed", "The document operation could not be completed", noStore);
        }
    });
}
async function boundedSourceResponse(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    const limit = 32 * 1024 * 1024, reader = response.body!.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const next = await reader.read();
            if (next.done)
                break;
            length += next.value.byteLength;
            if (length > limit)
                throw new HttpError(413, "source_preview_limit", "This source exceeds the 32 MiB preview limit");
            chunks.push(next.value);
        }
    }
    finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => undefined);
    }
    signal.throwIfAborted();
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}
async function withPacketSourceAdmission<T>(work: () => Promise<T>): Promise<T> {
    if (activePacketSourceOperations >= 2)
        throw new HttpError(503, "packet_preview_busy", "Document preview is busy; try again shortly");
    activePacketSourceOperations++;
    try {
        return await work();
    }
    finally {
        activePacketSourceOperations--;
    }
}
