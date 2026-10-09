/**
 * MeshSync agent API client (browser side).
 *
 * All requests go through the sandbox gateway as RELATIVE URLs with the target
 * agent port carried in the `XTransformPort` query parameter, exactly as
 * required by the deployment gateway (Caddy). Never an absolute URL.
 */

import type {
  AgentEvent,
  Conflict,
  ConflictResolution,
  DeviceInfo,
  DiscoveredPeerInfo,
  EventsResponse,
  FileDetail,
  FilesResponse,
  Folder,
  FoldersResponse,
  FolderResponse,
  Health,
  Peer,
  PeersResponse,
  PeerResponse,
  RescanResponse,
  Settings,
  SyncPlan,
  SyncRunResponse,
  SyncSession,
  SessionsResponse,
  Transfer,
  TransferActionKind,
  TransferDetail,
  TransferResponse,
  TransfersResponse,
  ConflictResponse,
  ConflictsResponse,
  DiscoveryScanResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Typed error carrying the agent's error envelope code + message. */
export class AgentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
  }
}

/** The agent could not be reached at all (offline, gateway 502, timeout). */
export class AgentUnreachableError extends Error {
  readonly port: number;

  constructor(port: number, detail?: string) {
    super(
      detail
        ? `agent at port ${port} unreachable: ${detail}`
        : `agent at port ${port} unreachable`
    );
    this.name = "AgentUnreachableError";
    this.port = port;
  }
}

export function isAgentError(err: unknown): err is AgentError {
  return err instanceof AgentError;
}

export function isUnreachableError(err: unknown): err is AgentUnreachableError {
  return err instanceof AgentUnreachableError;
}

// ---------------------------------------------------------------------------
// Base fetch
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

/** Builds the gateway-relative URL for an agent request. */
export function buildAgentUrl(port: number, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const sep = p.includes("?") ? "&" : "?";
  return `${p}${sep}XTransformPort=${port}`;
}

interface AgentFetchInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * Base function for every agent call. Appends `?XTransformPort=${port}`
 * (merging with any existing query), applies a 15s AbortController timeout and
 * parses the agent error envelope into a typed AgentError.
 */
export async function agentFetch<T>(
  port: number,
  path: string,
  init?: AgentFetchInit
): Promise<T> {
  const url = buildAgentUrl(port, path);
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (res.ok) {
      return parsed as T;
    }

    // Typed error envelope from the agent itself → the agent IS reachable.
    const env = parsed as { error?: { code?: string; message?: string } } | null;
    if (
      env &&
      typeof env.error === "object" &&
      env.error !== null &&
      typeof env.error.code === "string"
    ) {
      throw new AgentError(
        env.error.code,
        typeof env.error.message === "string"
          ? env.error.message
          : env.error.code,
        res.status
      );
    }

    // Gateway / non-agent failure (e.g. 502 while the agent is down).
    throw new AgentUnreachableError(port, `HTTP ${res.status}`);
  } catch (err) {
    if (err instanceof AgentError || err instanceof AgentUnreachableError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AgentUnreachableError(port, "request timed out");
    }
    throw new AgentUnreachableError(
      port,
      err instanceof Error ? err.message : "network error"
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Typed endpoint helpers
// ---------------------------------------------------------------------------

export function getHealth(port: number): Promise<Health> {
  return agentFetch<Health>(port, "/api/v1/health");
}

export function getDevice(port: number): Promise<DeviceInfo> {
  return agentFetch<DeviceInfo>(port, "/api/v1/device");
}

export function getPeers(port: number): Promise<PeersResponse> {
  return agentFetch<PeersResponse>(port, "/api/v1/peers");
}

export function pairPeer(
  port: number,
  address: string
): Promise<PeerResponse> {
  return agentFetch<PeerResponse>(port, "/api/v1/peers/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
}

export function approvePeer(port: number, peerId: string): Promise<PeerResponse> {
  return agentFetch<PeerResponse>(port, `/api/v1/peers/${encodeURIComponent(peerId)}/approve`, {
    method: "POST",
  });
}

export function revokePeer(port: number, peerId: string): Promise<PeerResponse> {
  return agentFetch<PeerResponse>(port, `/api/v1/peers/${encodeURIComponent(peerId)}/revoke`, {
    method: "POST",
  });
}

export function removePeer(port: number, peerId: string): Promise<void> {
  return agentFetch<void>(port, `/api/v1/peers/${encodeURIComponent(peerId)}`, {
    method: "DELETE",
  });
}

export function scanDiscovery(
  port: number
): Promise<DiscoveryScanResponse> {
  return agentFetch<DiscoveryScanResponse>(port, "/api/v1/discovery/scan", {
    method: "POST",
  });
}

export function getFolders(port: number): Promise<FoldersResponse> {
  return agentFetch<FoldersResponse>(port, "/api/v1/shared-folders");
}

export function addFolder(
  port: number,
  name: string,
  path: string
): Promise<FolderResponse> {
  return agentFetch<FolderResponse>(port, "/api/v1/shared-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path }),
  });
}

export function removeFolder(
  port: number,
  folderId: number,
  deleteFiles = false
): Promise<void> {
  return agentFetch<void>(port, `/api/v1/shared-folders/${folderId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleteFiles }),
  });
}

export function rescanFolder(port: number, folderId: number): Promise<RescanResponse> {
  return agentFetch<RescanResponse>(port, `/api/v1/shared-folders/${folderId}/rescan`, {
    method: "POST",
  });
}

export function listFiles(
  port: number,
  folderId: number,
  dir = ""
): Promise<FilesResponse> {
  const params = new URLSearchParams({ folder: String(folderId) });
  if (dir) params.set("path", dir);
  return agentFetch<FilesResponse>(port, `/api/v1/files?${params.toString()}`);
}

export function fileDetail(
  port: number,
  folderId: number,
  path: string
): Promise<FileDetail> {
  const params = new URLSearchParams({ folder: String(folderId), path });
  return agentFetch<FileDetail>(port, `/api/v1/files/detail?${params.toString()}`);
}

/** URL for downloading a file's real content through the gateway. */
export function fileContentUrl(
  port: number,
  folderId: number,
  path: string
): string {
  const params = new URLSearchParams({ folder: String(folderId), path });
  return `/api/v1/files/content?${params.toString()}&XTransformPort=${port}`;
}

export function createFile(
  port: number,
  folderId: number,
  path: string,
  content: string
): Promise<FileDetail> {
  return agentFetch<FileDetail>(port, "/api/v1/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: folderId, path, content, encoding: "utf8" }),
  });
}

export function uploadFile(
  port: number,
  folderId: number,
  path: string,
  file: File
): Promise<FileDetail> {
  const form = new FormData();
  form.set("folder", String(folderId));
  form.set("path", path);
  form.set("file", file);
  return agentFetch<FileDetail>(port, "/api/v1/files", {
    method: "POST",
    body: form,
  });
}

export function deleteFile(
  port: number,
  folderId: number,
  path: string
): Promise<void> {
  const params = new URLSearchParams({ folder: String(folderId), path });
  return agentFetch<void>(port, `/api/v1/files?${params.toString()}`, {
    method: "DELETE",
  });
}

export function syncPlan(
  port: number,
  peerId: string,
  folderId: number
): Promise<SyncPlan> {
  const params = new URLSearchParams({
    peer: peerId,
    folder: String(folderId),
  });
  return agentFetch<SyncPlan>(port, `/api/v1/sync/plan?${params.toString()}`);
}

export function syncRun(
  port: number,
  peerId: string,
  folderId: number
): Promise<SyncRunResponse> {
  return agentFetch<SyncRunResponse>(port, "/api/v1/sync/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peer: peerId, folder: folderId }),
  });
}

export function getSessions(port: number): Promise<SessionsResponse> {
  return agentFetch<SessionsResponse>(port, "/api/v1/sync/sessions");
}

export interface TransfersQuery {
  limit?: number;
  status?: string;
}

export function getTransfers(
  port: number,
  query: TransfersQuery = {}
): Promise<TransfersResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return agentFetch<TransfersResponse>(port, `/api/v1/transfers${qs ? `?${qs}` : ""}`);
}

export function getTransfer(port: number, transferId: string): Promise<TransferDetail> {
  return agentFetch<TransferDetail>(
    port,
    `/api/v1/transfers/${encodeURIComponent(transferId)}`
  );
}

export function transferAction(
  port: number,
  transferId: string,
  action: TransferActionKind
): Promise<TransferResponse> {
  return agentFetch<TransferResponse>(
    port,
    `/api/v1/transfers/${encodeURIComponent(transferId)}/${action}`,
    { method: "POST" }
  );
}

export function getConflicts(port: number): Promise<ConflictsResponse> {
  return agentFetch<ConflictsResponse>(port, "/api/v1/conflicts");
}

export function resolveConflict(
  port: number,
  conflictId: number,
  action: ConflictResolution
): Promise<ConflictResponse> {
  return agentFetch<ConflictResponse>(
    port,
    `/api/v1/conflicts/${conflictId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }
  );
}

export interface EventsQuery {
  sinceEventId?: number;
  limit?: number;
}

export function getEvents(
  port: number,
  query: EventsQuery = {}
): Promise<EventsResponse> {
  const params = new URLSearchParams();
  if (query.sinceEventId !== undefined)
    params.set("sinceEventId", String(query.sinceEventId));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return agentFetch<EventsResponse>(port, `/api/v1/events${qs ? `?${qs}` : ""}`);
}

export function getSettings(port: number): Promise<Settings> {
  return agentFetch<Settings>(port, "/api/v1/settings");
}

export function putSettings(
  port: number,
  settings: Partial<Settings>
): Promise<Settings> {
  return agentFetch<Settings>(port, "/api/v1/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  return `${dir}/${name}`;
}

export function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** Splits a relative path into clickable breadcrumb segments. */
export function pathSegments(path: string): string[] {
  return path ? path.split("/").filter(Boolean) : [];
}
