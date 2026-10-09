/**
 * TanStack Query key registry — namespaced by agent port so multiple agent
 * endpoints can live in the cache simultaneously.
 */

import type { AgentEvent, Transfer } from "./types";

export const TRANSFERS_LIMIT = 200;
export const EVENTS_INITIAL_LIMIT = 100;
export const EVENTS_CAP = 1500;

export const qk = {
  root: (port: number) => ["agent", port] as const,
  health: (port: number) => ["agent", port, "health"] as const,
  device: (port: number) => ["agent", port, "device"] as const,
  peers: (port: number) => ["agent", port, "peers"] as const,
  folders: (port: number) => ["agent", port, "folders"] as const,
  files: (port: number, folderId: number, path: string) =>
    ["agent", port, "files", folderId, path] as const,
  fileDetail: (port: number, folderId: number, path: string) =>
    ["agent", port, "fileDetail", folderId, path] as const,
  transfers: (port: number) => ["agent", port, "transfers"] as const,
  transfer: (port: number, transferId: string) =>
    ["agent", port, "transfer", transferId] as const,
  conflicts: (port: number) => ["agent", port, "conflicts"] as const,
  sessions: (port: number) => ["agent", port, "sessions"] as const,
  events: (port: number) => ["agent", port, "events"] as const,
  settings: (port: number) => ["agent", port, "settings"] as const,
};

// Cache payload types (kept in one place for WS + REST writers) -------------

/** Transfers list cache shape: newest/mixed as returned by the agent. */
export type TransfersCache = { transfers: Transfer[] };

/** Events cache shape: newest-first (descending by id). */
export type EventsCache = AgentEvent[];

/** Merges REST (ascending) + cached events into a deduped descending list. */
export function mergeEventsDesc(
  current: EventsCache,
  incoming: AgentEvent[]
): EventsCache {
  const byId = new Map<number, AgentEvent>();
  for (const e of incoming) byId.set(e.id, e);
  for (const e of current) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const merged = [...byId.values()].sort((a, b) => b.id - a.id);
  return merged.length > EVENTS_CAP
    ? merged.slice(0, EVENTS_CAP)
    : merged;
}

/** Upserts a transfer into the cached list (by id, keeps list order). */
export function upsertTransfer(
  cache: TransfersCache | undefined,
  transfer: Transfer
): TransfersCache {
  const list = cache?.transfers ? [...cache.transfers] : [];
  const idx = list.findIndex((t) => t.id === transfer.id);
  if (idx === -1) {
    list.unshift(transfer);
  } else {
    list[idx] = transfer;
  }
  return { transfers: list };
}
