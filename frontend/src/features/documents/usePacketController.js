import { useCallback, useEffect, useRef, useState } from "react";

const TERMINAL = new Set(["completed", "failed"]);
const emptyState = () => ({ packets: [], selectedId: "", selectedPacket: null, cursor: null, hasMore: false, loading: false, busy: false, error: "" });

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
    apply(ctx, { loading: true });
    try {
      const result = await ctx.requests.listPackets({ cursor: append ? stateRef.current.cursor : undefined });
      if (revision !== ctx.listRevision || context.current !== ctx) return;
      const incoming = Array.isArray(result?.packets) ? result.packets : [];
      const packets = append ? [...new Map([...stateRef.current.packets, ...incoming].map((packet) => [packet.packet_id, packet])).values()] : incoming;
      apply(ctx, { packets, cursor: result.next_cursor || null, hasMore: Boolean(result.has_more), error: "" });
    } catch (error) { fail(ctx, error); }
    finally { if (revision === ctx.listRevision) apply(ctx, { loading: false }); }
  }, [apply, fail]);

  const loadPacket = useCallback(async (id) => {
    const ctx = context.current;
    if (!ctx?.active || !id) return;
    const revision = ++ctx.detailRevision;
    try {
      const packet = await ctx.requests.getPacket(id);
      if (revision === ctx.detailRevision && ctx.selectedId === id) apply(ctx, { selectedPacket: packet, error: "" });
      return context.current === ctx && ctx.active ? packet : null;
    } catch (error) { fail(ctx, error); return null; }
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
        await refresh();
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
    apply(ctx, { selectedId: id || "", selectedPacket: stateRef.current.packets.find((packet) => packet.packet_id === id) || null, error: "" });
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

  const remove = useCallback(async (id) => {
    const ctx = context.current;
    if (!ctx?.active || stateRef.current.busy) return;
    apply(ctx, { busy: true, error: "" });
    try {
      await ctx.requests.deletePacket(id);
      if (context.current !== ctx || !ctx.active) return;
      ++ctx.listRevision;
      ++ctx.detailRevision;
      ctx.selectedId = "";
      apply(ctx, { selectedId: "", selectedPacket: null, packets: stateRef.current.packets.filter((packet) => packet.packet_id !== id) });
      callbacks.current.onJobsChanged?.();
      await refresh();
    } catch (error) { fail(ctx, error); }
    finally { apply(ctx, { busy: false }); }
  }, [apply, fail, refresh]);

  return {
    ...(context.current?.key === key ? state : emptyState()), refresh, select, admitted, confirmPlan, remove,
    loadOriginal: useCallback((id, options) => requests.getPacketOriginal(id, options), [requests]),
    loadPagePreview: useCallback((id, page, options) => requests.getPacketPagePreview(id, page, options), [requests]),
    clear: () => { if (context.current) context.current.active = false; setState(emptyState()); },
  };
}
