import { isJsonObject, parseJson, isString, isNumber } from "../../shared/json";
import type { SQLQueryBindings, Database } from "bun:sqlite";
import { costRangeDays, type CostDocument, type CostMetrics, type CostRange } from "../../shared/workspaceCosts";
import { addMetrics, emptyMetrics, readCostDocuments, readCostUpload } from "./workspaceCostProjection";

export type CostListQuery = CostRange & {
  sort: "recent" | "total" | "perPage";
  kind: "all" | "multi" | "single";
  search: string;
  cursor?: string | null;
};

type Position = { id: string; value: number | string };

const PAGE_SIZE = 50;

const SEARCH_BATCH = 200;

const SEARCH_CANDIDATES = 2000;

function indexedCandidates(db: Database, search: string): Array<{ rowid: number }> | null {
  const characters = [...search];

  if (characters.length < 3 || search.includes("\0")) return null;
  const offsets = new Set(Array.from({ length: 8 }, (_, index) => Math.floor((index * (characters.length - 3)) / 7)));

  const read = db.query<{ rowid: number }, SQLQueryBindings[]>(
    "SELECT rowid FROM cost_upload_search WHERE cost_upload_search MATCH ? LIMIT ?",
  );

  for (const offset of offsets) {
    const trigram = characters.slice(offset, offset + 3).join("");
    // Query ONE posting list, then verify the whole literal in JS. A full phrase with
    // LIMIT can still make FTS intersect/scan an unbounded number of nonmatching rows.
    const matches = read.all(`"${trigram.replaceAll('"', '""')}"`, SEARCH_CANDIDATES + 1);

    if (matches.length <= SEARCH_CANDIDATES) return matches;
  }

  return null;
}

function descending(a: Position, b: Position): number {
  return a.value < b.value ? 1 : a.value > b.value ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

const fingerprint = (query: CostListQuery) =>
  JSON.stringify([query.start, query.end, query.unit, query.sort, query.kind, query.search]);

function readCursor(query: CostListQuery): Position | null {
  if (!query.cursor) return null;

  try {
    if (query.cursor.length > 4000) throw new Error();
    const parsed = parseJson(Buffer.from(query.cursor, "base64url").toString());

    if (
      !isJsonObject(parsed) ||
      parsed.query !== fingerprint(query) ||
      !isString(parsed.id) ||
      parsed.id.length > 200 ||
      (query.sort === "recent"
        ? !isString(parsed.value) || !Number.isFinite(Date.parse(parsed.value))
        : !isNumber(parsed.value) || !Number.isFinite(parsed.value))
    )
      throw new Error();

    if (!isString(parsed.value) && !isNumber(parsed.value)) throw new Error();

    return { id: parsed.id, value: parsed.value };
  } catch {
    throw new RangeError("Invalid cost cursor for this query.");
  }
}

export function createCostQueries(db: Database) {
  function bucketRows(range: CostRange) {
    const step = range.unit === "hour" ? 3600000 : 86400000;
    const read = db.query<{ data: string }, SQLQueryBindings[]>("SELECT data FROM cost_buckets WHERE bucket=?");
    const buckets: Array<CostMetrics & { key: string; start: string; date: string; hour: number }> = [];

    for (let t = Date.parse(range.start); t < Date.parse(range.end); t += step) {
      const start = new Date(t).toISOString(),
        key = start.slice(0, range.unit === "hour" ? 13 : 10);

      const row = read.get(key);
      // SAFETY: cost_buckets.data is serialized from CostMetrics by createCostProjection.
      buckets.push({
        ...(row ? (JSON.parse(row.data) as CostMetrics) : emptyMetrics()),
        key,
        start,
        date: start.slice(0, 10),
        hour: new Date(t).getUTCHours(),
      });
    }

    return buckets;
  }

  function state() {
    const phase = db
      .query<{ phase: string }, SQLQueryBindings[]>("SELECT phase FROM cost_backfill WHERE singleton=1")
      .get()!;

    const earliest = db
      .query<{ created_at: string }, SQLQueryBindings[]>(
        "SELECT created_at FROM cost_uploads ORDER BY created_at,id LIMIT 1",
      )
      .get();

    return {
      updating: phase.phase !== "done" || Boolean(db.query("SELECT 1 FROM cost_dirty LIMIT 1").get()),
      historyBuilding: phase.phase !== "done",
      earliest: earliest?.created_at ?? null,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    getCostOverview(range: CostRange) {
      const metadata = state();
      const buckets = bucketRows(range);
      const totals = buckets.reduce((sum, bucket) => addMetrics(sum, bucket), emptyMetrics());
      const duration = Date.parse(range.end) - Date.parse(range.start);

      const previousRange = {
        ...range,
        start: new Date(Date.parse(range.start) - duration).toISOString(),
        end: range.start,
      };

      const previous =
        !metadata.historyBuilding && metadata.earliest && metadata.earliest <= previousRange.start
          ? bucketRows(previousRange).reduce((sum, bucket) => addMetrics(sum, bucket), emptyMetrics())
          : null;

      const quotas = new Map<string, number>();
      let remaining = Math.min(512, totals.fullyCostedDocuments);

      while (remaining > 0) {
        for (const bucket of buckets) {
          const count = quotas.get(bucket.key) ?? 0;

          if (count < bucket.fullyCostedDocuments) {
            quotas.set(bucket.key, count + 1);
            remaining -= 1;
          }

          if (!remaining) break;
        }
      }

      // Stratified bottom-hash samples: bounded indexed reads, weighted by each bucket's exact population.
      const sampleStatement = db.query<{ data: string }, SQLQueryBindings[]>(
        `SELECT data FROM cost_documents WHERE ${range.unit === "hour" ? "substr(created_at,1,13)" : "day"}=? AND eligible=1 ORDER BY sample_key,id LIMIT ?`,
      );

      const samples = buckets.flatMap((bucket) => {
        if (!bucket.fullyCostedDocuments) return [];
        const selected = sampleStatement.all(bucket.key, quotas.get(bucket.key) ?? 0);

        // SAFETY: cost_documents.data is serialized from CostDocument by createCostProjection.
        return selected.map((row) => ({
          ...(JSON.parse(row.data) as CostDocument),
          weight: bucket.fullyCostedDocuments / selected.length,
        }));
      });

      return {
        ...metadata,
        range,
        totals,
        previous,
        buckets,
        samples,
        sampled: samples.length < totals.fullyCostedDocuments,
      };
    },
    listCostUploads(query: CostListQuery) {
      const position = readCursor(query);
      const scanLimit = query.search ? SEARCH_BATCH : PAGE_SIZE;
      const kind = query.kind === "all" ? null : Number(query.kind === "multi");
      const search = query.search.toLowerCase();
      // Rare filenames use the trigram index. Cap posting-list work before sorting/filtering;
      // common and short terms fall back to bounded ordered batches with continuation.
      const matches = search ? indexedCandidates(db, search) : null;

      if (matches) {
        const column = query.sort === "recent" ? "created_at" : query.sort === "total" ? "total_sort" : "page_sort";

        const read = db.query<
          Position & { created_at: string; is_multi: number; search_text: string },
          SQLQueryBindings[]
        >(`SELECT id,${column} AS value,created_at,is_multi,search_text FROM cost_uploads WHERE rowid=?`);

        const matching = matches
          .flatMap(({ rowid }) => {
            const row = read.get(rowid)!;

            return row.created_at >= query.start &&
              row.created_at < query.end &&
              (kind === null || kind === row.is_multi) &&
              row.search_text.includes(search) &&
              (!position || descending(row, position) > 0)
              ? [row]
              : [];
          })
          .sort(descending);

        const page = matching.slice(0, PAGE_SIZE),
          last = page.at(-1);

        const cursor =
          last && matching.length > PAGE_SIZE
            ? Buffer.from(JSON.stringify({ id: last.id, value: last.value, query: fingerprint(query) })).toString(
                "base64url",
              )
            : null;

        return { ...state(), items: page.map((item) => readCostUpload(db, item.id)!), cursor, searchContinuing: false };
      }

      let candidates: Position[];

      if (query.sort === "recent") {
        candidates = db
          .query<Position, SQLQueryBindings[]>(
            `SELECT id,created_at AS value FROM cost_uploads WHERE created_at>=? AND created_at<?
          ${kind === null ? "" : "AND is_multi=?"} ${position ? "AND (created_at,id)<(?,?)" : ""}
          ORDER BY created_at DESC,id DESC LIMIT ?`,
          )
          .all(
            query.start,
            query.end,
            ...(kind === null ? [] : [kind]),
            ...(position ? [position.value, position.id] : []),
            scanLimit + 1,
          );
      } else {
        const column = query.sort === "total" ? "total_sort" : "page_sort";
        // Merge bounded per-day index walks; never sort the year's documents or scan older history.
        const partition = query.unit === "hour" ? "substr(created_at,1,13)" : "day";

        const read = db.query<
          Position,
          SQLQueryBindings[]
        >(`SELECT id,${column} AS value FROM cost_uploads WHERE ${partition}=? ${kind === null ? "" : "AND is_multi=?"}
          ${position ? `AND (${column},id)<(?,?)` : ""} ORDER BY ${column} DESC,id DESC LIMIT ?`);

        candidates = [];

        const partitions =
          query.unit === "hour"
            ? Array.from({ length: (Date.parse(query.end) - Date.parse(query.start)) / 3600000 }, (_, index) =>
                new Date(Date.parse(query.start) + index * 3600000).toISOString().slice(0, 13),
              )
            : costRangeDays(query);

        for (const day of partitions) {
          candidates.push(
            ...read.all(
              day,
              ...(kind === null ? [] : [kind]),
              ...(position ? [position.value, position.id] : []),
              scanLimit + 1,
            ),
          );
          candidates.sort(descending);
          candidates.length = Math.min(candidates.length, scanLimit + 1);
        }
      }

      const items = [];
      let consumed = 0;

      for (const candidate of candidates.slice(0, scanLimit)) {
        consumed += 1;

        // Literal search is applied only to a bounded candidate batch, including child/template names.
        const row = db
          .query<{ search_text: string }, SQLQueryBindings[]>("SELECT search_text FROM cost_uploads WHERE id=?")
          .get(candidate.id)!;

        if (!search || row.search_text.includes(search)) items.push(readCostUpload(db, candidate.id)!);

        if (items.length === PAGE_SIZE) break;
      }

      const last = candidates[consumed - 1];

      const cursor =
        last && candidates.length > consumed
          ? Buffer.from(JSON.stringify({ ...last, query: fingerprint(query) })).toString("base64url")
          : null;

      return { ...state(), items, cursor, searchContinuing: Boolean(search && cursor && items.length < PAGE_SIZE) };
    },
    getCostUpload(id: string) {
      const upload = readCostUpload(db, id);

      return upload ? { ...upload, children: readCostDocuments(db, id) } : null;
    },
  };
}
