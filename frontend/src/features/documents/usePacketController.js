import { useCallback, useEffect, useRef, useState } from "react";

const TERMINAL = new Set(["completed", "failed"]);
const emptyState = () => ({ packets: [], selectedId: "", selectedPacket: null, cursor: null, hasMore: false, loading: false, busy: false, error: "", detailStatus: "" });

// Match the API's descending (created_at, packet_id) order. A removed boundary
// is still covered once the refreshed page reaches a packet older than it.
function reachesLoadedBoundary(packet, boundary) {
  if (packet.packet_id === boundary.packet_id) return true;
  if (!packet.created_at || !boundary.created_at) return false;
  return packet.created_at < boundary.created_at ||
    (packet.created_at === boundary.created_at && packet.packet_id < boundary.packet_id);
}

/** Packet parents have their own lifecycle; they never become extraction rows or cached results. */
export function usePacketController({ requests, sessionId, workspaceId, enabled, onAccessDenied, onJobsChanged }) {
  const [state, setState] = useState(emptyState);
  const context = useRef(null);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const callbacks = useRef({ onAccessDenied, onJobsChanged });
  callbacks.current = { onAccessDenied, onJobsChanged };
  const key = enabled ? `${sessionId}\0${workspaceId}` : "";
  if (context.current?.key === key) context.current.requests = requests;
  const stateRef = useRef(state);
  stateRef.current = state;
  const apply = useCallback((ctx, patch) => {
    if (context.current === ctx && ctx?.active) setState((current) => ({ ...current, ...patch }));
  }, []);
  const fail = useCallback((ctx, error) => {
    if (context.current !== ctx || !ctx?.active) return;
    if (error.status === 403) callbacks.current.onAccessDenied?.();
    apply(ctx, { error: error.message || "Packet could not be loaded." });
  }, [apply]);

  const refresh = useCallback(async ({ append = false } = {}) => {
    const ctx = context.current;
    if (!ctx?.active || !ctx.requests.listPackets) return;
    const revision = ++ctx.listRevision;
    const boundary = append ? null : stateRef.current.packets.at(-1);
    apply(ctx, { loading: true });
    try {
      let cursor = append ? stateRef.current.cursor : undefined;
      let hasMore = false;
      const incoming = [];
      const visited = new Set();
      // Refresh the range the user has already loaded, not just its first page.
      // Following fresh cursors also covers new uploads and remote deletions.
      do {
        visited.add(cursor);
        const result = await ctx.requests.listPackets({ cursor });
        if (revision !== ctx.listRevision || context.current !== ctx || !ctx.active) return;
        const page = Array.isArray(result?.packets) ? result.packets : [];
        incoming.push(...page);
        cursor = result.next_cursor || null;
        hasMore = Boolean(result.has_more && cursor);
        if (append || !boundary || page.some((packet) => reachesLoadedBoundary(packet, boundary)) || !page.length) break;
      } while (hasMore && !visited.has(cursor));
      const packets = append ? [...new Map([...stateRef.current.packets, ...incoming].map((packet) => [packet.packet_id, packet])).values()] : incoming;
      apply(ctx, { packets, cursor, hasMore, error: "" });
    } catch (error) { if (revision === ctx.listRevision) fail(ctx, error); }
    finally { if (revision === ctx.listRevision) apply(ctx, { loading: false }); }
  }, [apply, fail]);

  const loadPacket = useCallback(async (id) => {
    const ctx = context.current;
    if (!ctx?.active || !id) return;
    const revision = ++ctx.detailRevision;
    try {
      const packet = await ctx.requests.getPacket(id);
      if (revision === ctx.detailRevision && ctx.selectedId === id) apply(ctx, { selectedPacket: packet, error: "", detailStatus: "" });
      return context.current === ctx && ctx.active ? packet : null;
    } catch (error) {
      if (revision === ctx.detailRevision && ctx.selectedId === id) {
        fail(ctx, error);
        apply(ctx, { detailStatus: error.status === 404 ? "missing" : "error", ...(error.status === 404 ? { selectedPacket: null } : {}) });
      }
      return null;
    }
  }, [apply, fail]);

  useEffect(() => {
    const ctx = { key, active: Boolean(key), requests: requestsRef.current, listRevision: 0, detailRevision: 0, selectedId: "" };
    context.current = ctx;
    setState(emptyState());
    if (ctx.active && ctx.requests.listPackets) void refresh();
    return () => { ctx.active = false; };
  }, [key, refresh]);

  const hasActivePackets = state.packets.some((packet) => !TERMINAL.has(packet.status));
  useEffect(() => {
    if (!key || !requestsRef.current.listPackets) return undefined;
    let cancelled = false;
    let timer;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (stateRef.current.loading) { schedule(); return; }
        await refresh();
        if (cancelled) return;
        const ctx = context.current;
        if (ctx?.selectedId) await loadPacket(ctx.selectedId);
        if (!cancelled) schedule();
      }, stateRef.current.packets.some((packet) => !TERMINAL.has(packet.status)) ? 6000 : 30000);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, refresh, loadPacket, hasActivePackets]);

  const select = useCallback((id) => {
    const ctx = context.current;
    if (!ctx?.active) return;
    ctx.selectedId = id || "";
    ++ctx.detailRevision;
    apply(ctx, { selectedId: id || "", selectedPacket: stateRef.current.packets.find((packet) => packet.packet_id === id) || null, error: "", detailStatus: "" });
    if (id) void loadPacket(id);
  }, [apply, loadPacket]);

  const admitted = useCallback((packet) => {
    const ctx = context.current;
    if (!ctx?.active) return;
    ctx.selectedId = packet.packet_id;
    ++ctx.listRevision;
    apply(ctx, { packets: [packet, ...stateRef.current.packets.filter((row) => row.packet_id !== packet.packet_id)], selectedId: packet.packet_id, selectedPacket: packet });
    void loadPacket(packet.packet_id);
    void refresh();
  }, [apply, loadPacket, refresh]);

  const confirmPlan = useCallback(async (id, plan) => {
    const ctx = context.current;
    if (!ctx?.active || stateRef.current.busy) return false;
    apply(ctx, { busy: true, error: "" });
    try {
      await ctx.requests.confirmPacketPlan(id, plan);
      if (context.current !== ctx || !ctx.active) return false;
      await loadPacket(id);
      await refresh();
      callbacks.current.onJobsChanged?.();
      return true;
    } catch (error) { if (error.status === 409) await loadPacket(id); fail(ctx, error); return false; }
    finally { apply(ctx, { busy: false }); }
  }, [apply, fail, loadPacket, refresh]);

  /** Deletes each packet with its children; resolves to the ids that were removed. */
  const removeMany = useCallback(async (ids) => {
    const ctx = context.current;
    if (!ctx?.active || stateRef.current.busy || !ids.length) return [];
    apply(ctx, { busy: true, error: "" });
    const removed = [];
    try {
      for (const id of ids) {
        try { await ctx.requests.deletePacket(id); removed.push(id); }
        catch (error) { if (error.status === 404) removed.push(id); else fail(ctx, error); }
        if (context.current !== ctx || !ctx.active) return removed;
      }
      ++ctx.listRevision;
      ++ctx.detailRevision;
      const gone = new Set(removed);
      if (gone.has(ctx.selectedId)) { ctx.selectedId = ""; apply(ctx, { selectedId: "", selectedPacket: null, detailStatus: "missing" }); }
      apply(ctx, { packets: stateRef.current.packets.filter((packet) => !gone.has(packet.packet_id)) });
      if (removed.length) callbacks.current.onJobsChanged?.();
      await refresh();
      return removed;
    } finally { apply(ctx, { busy: false }); }
  }, [apply, fail, refresh]);
  const remove = useCallback((id) => removeMany([id]), [removeMany]);
  // Adapter replacements during polling must not restart a pending source preview.
  // A context change still replaces these callbacks and cancels the old preview.
  const loadOriginal = useCallback((id, options) => {
    const ctx = context.current;
    if (!ctx?.active || ctx.key !== key) return Promise.reject(new DOMException("Workspace changed", "AbortError"));
    return ctx.requests.getPacketOriginal(id, options);
  }, [key]);
  const loadPagePreview = useCallback((id, page, options) => {
    const ctx = context.current;
    if (!ctx?.active || ctx.key !== key) return Promise.reject(new DOMException("Workspace changed", "AbortError"));
    return ctx.requests.getPacketPagePreview(id, page, options);
  }, [key]);

  return {
    ...(context.current?.key === key ? state : emptyState()), refresh, select, admitted, confirmPlan, remove, removeMany,
    loadOriginal, loadPagePreview,
    clear: () => { if (context.current) context.current.active = false; setState(emptyState()); },
  };
}
