import type { Database } from "bun:sqlite";
import { newId } from "./lib/ids";
import type { LocalWorkspaceProductStore, LocalWorkspaceExtractionJobSummary } from "./localWorkspaceProductStore";
import type { WorkspaceDocumentProcessingSettings } from "./workspaceDocumentProcessing";
import { DocumentAssessmentValidationError, validateSplitPlan } from "./consumer/documentAssessment";
export type RoutingCandidate = {
    id: string;
    name: string;
    description: string | null;
    template_version: number;
    tags: string[];
};
export type DocumentRouting = {
    job_id: string;
    template_tags: string[];
    selection_mode: "explicit" | "automatic" | "manual";
    routing_status: "pending" | "assessing" | "awaiting_template" | "resolved";
    selection_reason: string | null;
    routing_rounds: number;
    parent_packet_id: string | null;
    source_pages: number[] | null;
    candidates: RoutingCandidate[];
    evidence: string[];
    configuration_snapshot: unknown;
};
export type ProcessingSource = {
    source_file_key: string;
    retained_object_key: string | null;
    source_mime_type: string;
    source_name: string | null;
    source_retained: boolean;
    source_retained_remotely: boolean;
};
export type PacketExclusion = {
    page: number;
    reason: string;
    verified_blank?: boolean;
};
export type PacketChildSlot = {
    job_id: string;
    pages: number[];
    state: "reserved" | "materialized" | "deleted";
    source_file_key: string | null;
    retained_object_key: string | null;
};
export type DocumentPacket = {
    packet_id: string;
    status: "queued" | "processing" | "awaiting_review" | "materializing" | "processing_children" | "completed" | "failed";
    stage: "analysis" | "review" | "materialization" | "extraction" | "finished";
    source_name: string | null;
    source_mime_type: string;
    source_file_page_count: number;
    source_file_key: string;
    source_retained: boolean;
    template_id: string | null;
    template_version: number | null;
    template_tags: string[];
    selected_pages: number[];
    processing_policy: WorkspaceDocumentProcessingSettings;
    plan_revision: number;
    plan_accepted: boolean;
    plan: {
        groups: {
            pages: number[];
        }[];
        exclusions: PacketExclusion[];
    };
    children: LocalWorkspaceExtractionJobSummary[];
    child_slots: PacketChildSlot[];
    reason: string | null;
    evidence: string[];
    assessment_rounds: number;
    configuration_snapshot: unknown;
    error_code: string | null;
    error_message: string | null;
    outcome: "no_documents" | null;
    created_at: string;
    updated_at: string;
};
type PacketInput = {
    packetId: string;
    templateId: string | null;
    templateVersion: number | null;
    templateTags: string[];
    selectedPages: number[];
    processingPolicy: WorkspaceDocumentProcessingSettings;
    sourceFileKey: string;
    sourceMimeType: string;
    sourceName: string | null;
    sourceFilePageCount: number;
    sourceRetained?: boolean;
    retainedObjectKey?: string | null;
    submittedAt: string;
};
type RoundInput = {
    updatedAt: string;
    configurationSnapshot: unknown;
};
type AssessmentInput = {
    round: number;
    reason: string;
    evidence: string[];
    updatedAt: string;
};
export type DocumentProcessingStore = ReturnType<typeof createDocumentProcessingStore>;
export function initializeDocumentProcessingSchema(database: Database): void {
    database.transaction(() => {
        const applied = database.query("SELECT 1 FROM product_schema_version WHERE version = 11").get();
        if (applied)
            return;
        // Preserve rowids used by the external-content search index, and reinstall every
        // existing index/trigger after relaxing the binding and status constraints.
        const schema = database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get() as {
            sql: string;
        };
        const auxiliaries = database.query("SELECT sql FROM sqlite_master WHERE tbl_name = 'jobs' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as {
            sql: string;
        }[];
        const columns = (database.query("PRAGMA table_info(jobs)").all() as {
            name: string;
        }[]).map(({ name }) => `"${name}"`).join(",");
        const replacement = schema.sql.replace(/CREATE TABLE\s+"?jobs"?/i, "CREATE TABLE jobs_processing_migration")
            .replace(/template_id TEXT NOT NULL/i, "template_id TEXT")
            .replace(/template_version INTEGER NOT NULL/i, "template_version INTEGER")
            .replace(/'queued',\s*'processing',\s*'completed',\s*'failed'/, "'queued', 'processing', 'completed', 'failed', 'awaiting_template'");
        database.exec(replacement);
        database.exec(`INSERT INTO jobs_processing_migration (rowid,${columns}) SELECT rowid,${columns} FROM jobs`);
        database.exec("DROP TABLE jobs; ALTER TABLE jobs_processing_migration RENAME TO jobs");
        for (const { sql } of auxiliaries)
            database.exec(sql);
        database.exec("INSERT INTO job_search(job_search) VALUES ('rebuild')");
        database.exec("INSERT OR IGNORE INTO job_status_totals(status,count) VALUES ('awaiting_template',0)");
        for (const [name, type] of [["classification_model_name", "TEXT"], ["classification_supports_pdf_input", "INTEGER"], ["classification_supports_structured_output", "INTEGER"]]) {
            database.exec(`ALTER TABLE workspace_model_configuration ADD COLUMN ${name} ${type}`);
        }
        database.exec(`
      CREATE TABLE document_routing (
        job_id TEXT PRIMARY KEY, template_tags TEXT NOT NULL, selection_mode TEXT NOT NULL,
        routing_status TEXT NOT NULL, selection_reason TEXT, routing_rounds INTEGER NOT NULL DEFAULT 0,
        parent_packet_id TEXT, source_pages TEXT, candidates TEXT NOT NULL DEFAULT '[]', evidence TEXT NOT NULL DEFAULT '[]', configuration_snapshot TEXT
      );
      CREATE INDEX idx_document_routing_parent ON document_routing(parent_packet_id);
      CREATE TABLE document_packets (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, source_file_key TEXT NOT NULL, source_mime_type TEXT NOT NULL,
        source_name TEXT, source_file_page_count INTEGER NOT NULL, template_id TEXT, template_version INTEGER,
        template_tags TEXT NOT NULL, selected_pages TEXT NOT NULL, processing_policy TEXT NOT NULL,
        plan_revision INTEGER NOT NULL DEFAULT 1, plan_accepted INTEGER NOT NULL DEFAULT 0,
        groups_json TEXT NOT NULL DEFAULT '[]', exclusions_json TEXT NOT NULL DEFAULT '[]',
        assessment_rounds INTEGER NOT NULL DEFAULT 0, reason TEXT, evidence TEXT NOT NULL DEFAULT '[]', configuration_snapshot TEXT,
        error_code TEXT, error_message TEXT, outcome TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_document_packets_created ON document_packets(created_at DESC,id DESC);
      CREATE INDEX idx_document_packets_runnable ON document_packets(status,updated_at);
      CREATE TABLE document_packet_children (
        packet_id TEXT NOT NULL, job_id TEXT PRIMARY KEY, position INTEGER NOT NULL, pages TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'reserved', source_file_key TEXT, retained_object_key TEXT
      );
      CREATE INDEX idx_document_packet_children_parent ON document_packet_children(packet_id,position);
    `);
        database.query("INSERT INTO product_schema_version(version,applied_at) VALUES (11,?)").run(new Date().toISOString());
    }).immediate();
}
export function createDocumentProcessingStore(database: Database, store: () => LocalWorkspaceProductStore) {
    const getRouting = (jobId: string): DocumentRouting | null => {
        const row = database.query("SELECT * FROM document_routing WHERE job_id = ?").get(jobId) as Record<string, any> | null;
        if (!row)
            return null;
        return { ...row, template_tags: JSON.parse(row.template_tags), source_pages: row.source_pages ? JSON.parse(row.source_pages) : null,
            candidates: JSON.parse(row.candidates), evidence: JSON.parse(row.evidence), configuration_snapshot: parse(row.configuration_snapshot) } as DocumentRouting;
    };
    const candidates = (tags: string[]): RoutingCandidate[] => {
        if (!tags.length)
            return [];
        const rows = database.query(`SELECT DISTINCT p.id,p.name,p.description,p.current_version AS template_version FROM templates p
      JOIN template_tag_assignments a ON a.template_id=p.id JOIN template_tags t ON t.id=a.tag_id
      WHERE p.status='active' AND p.deleted_at IS NULL AND t.name IN (${tags.map(() => "?").join(",")})
      AND EXISTS (SELECT 1 FROM template_fields f WHERE f.template_id=p.id AND f.version=p.current_version)
      ORDER BY p.id LIMIT 101`).all(...tags) as Omit<RoutingCandidate, "tags">[];
        return rows.map((row) => ({ ...row, tags: (database.query(`SELECT t.name FROM template_tags t JOIN template_tag_assignments a ON a.tag_id=t.id WHERE a.template_id=? ORDER BY t.name`).all(row.id) as {
                name: string;
            }[]).map(t => t.name) }));
    };
    const getSource = (ownerId: string): ProcessingSource | null => {
        const row = database.query(`SELECT key AS source_file_key,retained_key AS retained_object_key,mime_type AS source_mime_type,name AS source_name,retained AS source_retained FROM source_files WHERE job_id=? AND (deleted_at IS NULL OR retained_key IS NOT NULL)`).get(ownerId) as (Omit<ProcessingSource, "source_retained_remotely" | "source_retained"> & {
            source_retained: number;
        }) | null;
        return row && { ...row, source_retained: Boolean(row.source_retained), source_retained_remotely: Boolean(row.retained_object_key) };
    };
    const getPacket = (packetId: string): DocumentPacket | null => {
        const row = database.query("SELECT * FROM document_packets WHERE id=?").get(packetId) as Record<string, any> | null;
        if (!row)
            return null;
        const slots = (database.query("SELECT job_id,pages,state,source_file_key,retained_object_key FROM document_packet_children WHERE packet_id=? ORDER BY position").all(packetId) as Array<Omit<PacketChildSlot, "pages"> & {
            pages: string;
        }>).map(r => ({ ...r, pages: JSON.parse(r.pages) }));
        const children = slots.flatMap(slot => { const job = store().getExtractionJobSummary(slot.job_id); return job ? [job] : []; });
        let status = row.status as DocumentPacket["status"];
        if (status === "processing_children" && children.every(child => ["completed", "failed"].includes(child.status))) {
            status = children.some(child => child.status === "failed") ? "failed" : "completed";
            database.query("UPDATE document_packets SET status=? WHERE id=? AND status='processing_children'").run(status, packetId);
        }
        return { packet_id: row.id, status, stage: status === "awaiting_review" ? "review" : status === "materializing" ? "materialization" : status === "processing_children" ? "extraction" : ["completed", "failed"].includes(status) ? "finished" : "analysis",
            source_file_key: row.source_file_key, source_name: row.source_name, source_mime_type: row.source_mime_type, source_file_page_count: row.source_file_page_count, source_retained: Boolean(getSource(packetId)?.source_retained),
            template_id: row.template_id, template_version: row.template_version, template_tags: JSON.parse(row.template_tags), selected_pages: JSON.parse(row.selected_pages), processing_policy: JSON.parse(row.processing_policy),
            plan_revision: row.plan_revision, plan_accepted: Boolean(row.plan_accepted), plan: { groups: JSON.parse(row.groups_json).map((pages: number[]) => ({ pages })), exclusions: JSON.parse(row.exclusions_json) },
            children, child_slots: slots, reason: row.reason, evidence: JSON.parse(row.evidence), assessment_rounds: row.assessment_rounds, configuration_snapshot: parse(row.configuration_snapshot),
            error_code: row.error_code, error_message: row.error_message, outcome: row.outcome, created_at: row.created_at, updated_at: row.updated_at };
    };
    return {
        getDocumentRouting: getRouting,
        getRoutingCandidates: candidates,
        getProcessingSource: getSource,
        claimRoutingRound: (input: RoundInput & {
            jobId: string;
        }) => database.transaction(() => {
            const row = getRouting(input.jobId);
            const job = store().getExtractionJobSummary(input.jobId);
            if (!row || !job || job.template_id || job.status !== "queued" || row.routing_rounds >= 3)
                return null;
            const snapshot = candidates(row.template_tags);
            database.query("UPDATE document_routing SET routing_rounds=routing_rounds+1,routing_status='assessing',candidates=?,configuration_snapshot=? WHERE job_id=?").run(JSON.stringify(snapshot), JSON.stringify(input.configurationSnapshot), input.jobId);
            database.query("UPDATE jobs SET updated_at=? WHERE id=?").run(input.updatedAt, input.jobId);
            return getRouting(input.jobId);
        }).immediate(),
        holdDocumentRouting: (input: {
            jobId: string;
            reason: string;
            evidence?: string[];
            updatedAt: string;
        }) => database.transaction(() => {
            if (!database.query("UPDATE jobs SET status='awaiting_template',updated_at=? WHERE id=? AND template_id IS NULL AND status='queued'").run(input.updatedAt, input.jobId).changes)
                return false;
            database.query("UPDATE document_routing SET routing_status='awaiting_template',selection_reason=?,evidence=? WHERE job_id=?").run(input.reason.slice(0, 2000), JSON.stringify(input.evidence ?? []), input.jobId);
            return true;
        }).immediate(),
        recordRoutingAssessment: (input: AssessmentInput & {
            jobId: string;
        }) => database.query("UPDATE document_routing SET selection_reason=?,evidence=? WHERE job_id=? AND routing_rounds=? AND routing_status='assessing'").run(input.reason.slice(0, 2000), JSON.stringify(input.evidence), input.jobId, input.round).changes > 0,
        bindDocumentTemplate: (input: {
            jobId: string;
            templateId: string;
            manual?: boolean;
            expectedRound?: number;
            updatedAt: string;
        }) => database.transaction(() => {
            const routing = getRouting(input.jobId), job = store().getExtractionJobSummary(input.jobId), template = store().getSubmissionTemplate(input.templateId);
            if (!routing || !job || job.template_id || !template)
                return false;
            if (input.manual ? job.status !== "awaiting_template" : job.status !== "queued" || routing.routing_rounds !== input.expectedRound)
                return false;
            if (!input.manual) {
                const before = routing.candidates.find(c => c.id === input.templateId), current = candidates(routing.template_tags).find(c => c.id === input.templateId);
                if (!before || !current || JSON.stringify(before) !== JSON.stringify(current))
                    return false;
            }
            database.query("UPDATE jobs SET template_id=?,template_version=?,status='queued',updated_at=?,error_code=NULL,error_message=NULL WHERE id=?").run(template.template_id, template.template_version, input.updatedAt, input.jobId);
            database.query("UPDATE document_routing SET routing_status='resolved',selection_mode=? WHERE job_id=?").run(input.manual ? "manual" : "automatic", input.jobId);
            return true;
        }).immediate(),
        createDocumentPacket: (input: PacketInput) => database.transaction(() => {
            database.query("INSERT INTO source_files(key,job_id,mime_type,name,page_count,created_at,retained,retained_key) VALUES (?,?,?,?,?,?,?,?)").run(input.sourceFileKey, input.packetId, input.sourceMimeType, input.sourceName, input.sourceFilePageCount, input.submittedAt, Number(Boolean(input.sourceRetained || input.retainedObjectKey)), input.retainedObjectKey ?? null);
            database.query(`INSERT INTO document_packets(id,status,source_file_key,source_mime_type,source_name,source_file_page_count,template_id,template_version,template_tags,selected_pages,processing_policy,created_at,updated_at) VALUES (?,'queued',?,?,?,?,?,?,?,?,?,?,?)`).run(input.packetId, input.sourceFileKey, input.sourceMimeType, input.sourceName, input.sourceFilePageCount, input.templateId, input.templateVersion, JSON.stringify(input.templateTags), JSON.stringify(input.selectedPages), JSON.stringify(input.processingPolicy), input.submittedAt, input.submittedAt);
            return getPacket(input.packetId)!;
        }).immediate(),
        getDocumentPacket: getPacket,
        listDocumentPackets: (input: {
            limit?: number;
            cursor?: {
                createdAt: string;
                packetId: string;
            };
        } = {}) => {
            const rows = (input.cursor ? database.query("SELECT id FROM document_packets WHERE (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?").all(input.cursor.createdAt, input.cursor.packetId, input.limit ?? 50) : database.query("SELECT id FROM document_packets ORDER BY created_at DESC,id DESC LIMIT ?").all(input.limit ?? 50)) as {
                id: string;
            }[];
            return rows.map(row => getPacket(row.id)!);
        },
        claimPacketRound: (input: RoundInput & {
            packetId: string;
        }) => database.transaction(() => {
            const changed = database.query("UPDATE document_packets SET status='processing',assessment_rounds=assessment_rounds+1,configuration_snapshot=?,updated_at=? WHERE id=? AND status IN ('queued','processing') AND assessment_rounds<3 AND plan_accepted=0").run(JSON.stringify(input.configurationSnapshot), input.updatedAt, input.packetId).changes;
            return changed ? getPacket(input.packetId) : null;
        }).immediate(),
        recordPacketAssessment: (input: AssessmentInput & {
            packetId: string;
            groups?: number[][];
            exclusions?: PacketExclusion[];
        }) => database.query("UPDATE document_packets SET reason=?,evidence=?,groups_json=COALESCE(?,groups_json),exclusions_json=COALESCE(?,exclusions_json),updated_at=? WHERE id=? AND assessment_rounds=? AND status='processing'").run(input.reason.slice(0, 2000), JSON.stringify(input.evidence), input.groups ? JSON.stringify(input.groups) : null, input.exclusions ? JSON.stringify(input.exclusions) : null, input.updatedAt, input.packetId, input.round).changes > 0,
        failDocumentPacket: (input: {
            packetId: string;
            reason: string;
            updatedAt: string;
        }) => database.transaction(() => {
            const changed = database.query("UPDATE document_packets SET status='failed',error_code='packet_processing_failed',error_message=?,updated_at=? WHERE id=? AND status NOT IN ('completed','failed')").run(input.reason.slice(0, 2000), input.updatedAt, input.packetId).changes > 0;
            if (!changed)
                return false;
            // A previous materialization attempt may have crashed after its file
            // or S3 reservation. Terminal failure releases only uncommitted slots;
            // independently accepted children keep their own source ownership.
            const abandoned = database.query("SELECT job_id,source_file_key,retained_object_key FROM document_packet_children WHERE packet_id=? AND state='reserved' AND source_file_key IS NOT NULL").all(input.packetId) as Array<{
                job_id: string;
                source_file_key: string;
                retained_object_key: string | null;
            }>;
            for (const slot of abandoned) {
                database.query("INSERT OR REPLACE INTO source_file_deletion_intents(job_id,source_file_key,retained_key) VALUES (?,?,?)").run(slot.job_id, slot.source_file_key, slot.retained_object_key);
            }
            database.query("UPDATE document_packet_children SET state='deleted' WHERE packet_id=? AND state='reserved'").run(input.packetId);
            return true;
        }).immediate(),
        holdDocumentPacket: (input: {
            packetId: string;
            reason: string;
            updatedAt: string;
        }) => database.query("UPDATE document_packets SET status='awaiting_review',reason=?,updated_at=? WHERE id=? AND plan_accepted=0 AND status IN ('queued','processing')").run(input.reason.slice(0, 2000), input.updatedAt, input.packetId).changes > 0,
        acceptDocumentPacketPlan: (input: {
            packetId: string;
            revision: number;
            groups: number[][];
            exclusions: PacketExclusion[];
            updatedAt: string;
            manual?: boolean;
            expectedRound?: number;
            verifiedBlankPages?: number[];
        }) => database.transaction(() => {
            const packet = getPacket(input.packetId);
            if (!packet || packet.plan_accepted || packet.plan_revision !== input.revision || (input.manual ? packet.status !== "awaiting_review" : !["queued", "processing"].includes(packet.status)))
                return null;
            if (!input.manual && (input.expectedRound === undefined || packet.assessment_rounds !== input.expectedRound || input.expectedRound < 1))
                return null;
            const blankRemoval = packet.processing_policy.enable_smart_splitting && packet.processing_policy.exclude_blank_pages;
            const plan = validateSplitPlan(input.groups, input.exclusions.map(exclusion => ({ ...exclusion, verified_blank: exclusion.verified_blank === true })), packet.selected_pages, blankRemoval, input.manual);
            const noDocuments = plan.groups.length === 0;
            if (noDocuments) {
                // A client flag is not blank verification. The trusted assessor persists
                // verified exclusions, or the HTTP owner supplies independently verified
                // page numbers after inspecting the retained source for a manual plan.
                const verified = new Set(input.manual && input.verifiedBlankPages
                    ? input.verifiedBlankPages
                    : packet.plan.exclusions.filter(exclusion => exclusion.verified_blank).map(exclusion => exclusion.page));
                if (plan.exclusions.some(exclusion => !verified.has(exclusion.page)))
                    throw new DocumentAssessmentValidationError("Zero-document completion requires independently verified blank pages");
            }
            database.query("UPDATE document_packets SET status=?,groups_json=?,exclusions_json=?,plan_accepted=1,plan_revision=plan_revision+1,outcome=?,updated_at=? WHERE id=?").run(noDocuments ? "completed" : "materializing", JSON.stringify(plan.groups), JSON.stringify(plan.exclusions), noDocuments ? "no_documents" : null, input.updatedAt, input.packetId);
            plan.groups.forEach((pages, position) => database.query("INSERT INTO document_packet_children(packet_id,job_id,position,pages) VALUES (?,?,?,?)").run(input.packetId, newId("job"), position, JSON.stringify(pages)));
            return getPacket(input.packetId);
        }).immediate(),
        reservePacketChildSource: (input: {
            packetId: string;
            jobId: string;
            sourceFileKey: string;
            retainedObjectKey?: string | null;
        }) => database.query("UPDATE document_packet_children SET source_file_key=?,retained_object_key=? WHERE packet_id=? AND job_id=? AND state='reserved' AND EXISTS(SELECT 1 FROM document_packets WHERE id=?)").run(input.sourceFileKey, input.retainedObjectKey ?? null, input.packetId, input.jobId, input.packetId).changes > 0,
        materializePacketChild: (input: {
            packetId: string;
            jobId: string;
            sourceFileKey: string;
            sourceFilePageCount: number;
            retainedObjectKey?: string | null;
            updatedAt: string;
        }) => database.transaction(() => {
            const packet = getPacket(input.packetId), slot = packet?.child_slots.find(c => c.job_id === input.jobId);
            if (!packet || !slot || slot.state !== "reserved" || packet.status !== "materializing")
                return null;
            if (input.sourceFilePageCount !== slot.pages.length)
                throw new DocumentAssessmentValidationError("Derived source page count does not match its committed group");
            const source = getSource(input.packetId);
            const queued = store().createQueuedExtractionJob({ jobId: input.jobId, templateId: packet.template_id, templateVersion: packet.template_version, templateTags: packet.template_tags, parentPacketId: input.packetId, sourcePages: slot.pages, sourceFileKey: input.sourceFileKey, sourceMimeType: "application/pdf", sourceName: packet.source_name, sourceFilePageCount: input.sourceFilePageCount, sourceRetained: source?.source_retained, retainedObjectKey: input.retainedObjectKey, submittedAt: input.updatedAt });
            database.query("UPDATE document_packet_children SET state='materialized',source_file_key=?,retained_object_key=? WHERE job_id=?").run(input.sourceFileKey, input.retainedObjectKey ?? null, input.jobId);
            return queued;
        }).immediate(),
        finishPacketMaterialization: (input: {
            packetId: string;
            updatedAt: string;
        }) => database.query("UPDATE document_packets SET status='processing_children',updated_at=? WHERE id=? AND status='materializing' AND NOT EXISTS (SELECT 1 FROM document_packet_children WHERE packet_id=? AND state='reserved')").run(input.updatedAt, input.packetId, input.packetId).changes > 0,
        recoverDocumentPackets: (input: {
            limit: number;
            staleProcessingBefore: string;
            isJobActive?: (id: string) => boolean;
        }) => {
            const rows = database.query("SELECT id AS job_id,template_id,template_version FROM document_packets WHERE status IN ('queued','materializing') OR (status='processing' AND updated_at<=?) ORDER BY created_at LIMIT ?").all(input.staleProcessingBefore, input.limit) as {
                job_id: string;
                template_id: string | null;
                template_version: number | null;
            }[];
            return rows.filter(r => !input.isJobActive?.(r.job_id)).map(r => ({ ...r, kind: "packet" as const, attempt: 1 }));
        },
        deleteDocumentPacket: (input: {
            packetId: string;
        }) => database.transaction(() => {
            const packet = getPacket(input.packetId);
            if (!packet)
                return null;
            const sources: {
                job_id: string;
                source_file_key: string;
                retained_object_key: string | null;
            }[] = [];
            for (const slot of packet.child_slots) {
                const deleted = store().deleteExtractionJob({ jobId: slot.job_id });
                if (deleted)
                    sources.push(deleted);
                else if (slot.source_file_key) {
                    database.query("INSERT OR REPLACE INTO source_file_deletion_intents(job_id,source_file_key,retained_key) VALUES (?,?,?)").run(slot.job_id, slot.source_file_key, slot.retained_object_key);
                    sources.push({ job_id: slot.job_id, source_file_key: slot.source_file_key, retained_object_key: slot.retained_object_key });
                }
            }
            // Keep a durable cleanup pointer even for an already-cleaned original.
            const source = database.query("SELECT key AS source_file_key,retained_key AS retained_object_key FROM source_files WHERE job_id=?").get(input.packetId) as {
                source_file_key: string;
                retained_object_key: string | null;
            } | null;
            if (source) {
                database.query("INSERT OR REPLACE INTO source_file_deletion_intents(job_id,source_file_key,retained_key) VALUES (?,?,?)").run(input.packetId, source.source_file_key, source.retained_object_key);
                sources.push({ job_id: input.packetId, ...source });
            }
            database.query("DELETE FROM document_packet_children WHERE packet_id=?").run(input.packetId);
            database.query("DELETE FROM source_files WHERE job_id=?").run(input.packetId);
            database.query("DELETE FROM document_packets WHERE id=?").run(input.packetId);
            return { packet_id: input.packetId, sources };
        }).immediate(),
    };
}
function parse(value: string | null) { return value ? JSON.parse(value) : null; }
