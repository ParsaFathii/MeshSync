/**
 * MeshSync agent API contract types — consumer side.
 * Mirrors docs/API.md (frozen v1) exactly.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type TrustLevel = "DISCOVERED" | "PAIRING" | "TRUSTED" | "REVOKED";

export type TransferStatus =
  | "QUEUED"
  | "PREPARING"
  | "TRANSFERRING"
  | "VERIFYING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type TransferDirection = "PUSH" | "PULL" | "NONE";

export type FileSyncState =
  | "SYNCED"
  | "PENDING"
  | "SYNCING"
  | "CONFLICT"
  | "LOCAL_ONLY";

export type PlanActionState =
  | "UNCHANGED"
  | "LOCAL_ONLY"
  | "REMOTE_ONLY"
  | "LOCAL_MODIFIED"
  | "REMOTE_MODIFIED"
  | "CONFLICT"
  | "DELETE_LOCAL"
  | "DELETE_REMOTE";

export type ConflictStatus = "OPEN" | "RESOLVED";

export type ConflictResolution =
  | "KEEP_LOCAL"
  | "KEEP_REMOTE"
  | "KEEP_BOTH"
  | "LATER";

export type EventSeverity = "INFO" | "WARN" | "ERROR";

export type EventType =
  | "PEER_DISCOVERED"
  | "PAIR_REQUESTED"
  | "PAIR_APPROVED"
  | "PEER_REVOKED"
  | "PEER_ONLINE"
  | "PEER_OFFLINE"
  | "SYNC_STARTED"
  | "SYNC_COMPLETED"
  | "SYNC_FAILED"
  | "TRANSFER_STARTED"
  | "TRANSFER_PROGRESS"
  | "TRANSFER_COMPLETED"
  | "TRANSFER_FAILED"
  | "TRANSFER_PAUSED"
  | "TRANSFER_RESUMED"
  | "TRANSFER_CANCELLED"
  | "CONFLICT_DETECTED"
  | "CONFLICT_RESOLVED"
  | "FILE_INDEXED"
  | "FILE_CHANGED"
  | "FILE_DELETED"
  | "FOLDER_ADDED"
  | "FOLDER_REMOVED"
  | "SETTINGS_UPDATED"
  | "NATIVE_FALLBACK";

export type TransferActionKind = "pause" | "resume" | "cancel" | "retry";

export type ChunkState = "DONE" | "ACTIVE" | "PENDING" | "FAILED";

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export interface Health {
  status: string;
  version: string;
  uptimeSeconds: number;
  dbOk: boolean;
}

export interface DeviceStats {
  folders: number;
  filesIndexed: number;
  bytesIndexed: number;
  peersTrusted: number;
  peersOnline: number;
  transfersActive: number;
  transfersCompleted: number;
  conflictsOpen: number;
  lastSyncAt: string | null;
}

export interface DeviceInfo {
  peerId: string;
  name: string;
  version: string;
  platform: string;
  startedAt: string;
  apiPort: number;
  peerPort: number;
  keyFingerprint: string;
  nativeEngine: string;
  stats: DeviceStats;
}

export interface Peer {
  peerId: string;
  name: string;
  address: string;
  trust: TrustLevel;
  online: boolean;
  version: string;
  platform: string;
  lastSeen: string | null;
  addedAt: string;
  sharedFolders: number;
}

export interface DiscoveredPeerInfo {
  peerId: string;
  name: string;
  address: string;
  version: string;
}

export interface Folder {
  id: number;
  name: string;
  path: string;
  fileCount: number;
  totalBytes: number;
  lastScanAt: string | null;
}

export interface FolderRef {
  id: number;
  name: string;
}

export type FileEntry =
  | {
      name: string;
      type: "dir";
      fileCount: number;
      totalBytes: number;
    }
  | {
      name: string;
      type: "file";
      size: number;
      mtime: string | null;
      hash: string | null;
      syncState: FileSyncState | null;
      lastSyncedHash: string | null;
      remotePeers: string[];
    };

export interface TransferChunk {
  index: number;
  size: number;
  state: ChunkState;
}

export interface PeerFileState {
  hash: string | null;
  size: number | null;
  mtime: string | null;
  seenAt: string | null;
}

export interface FileDetail {
  type: "file";
  name: string;
  folder: FolderRef;
  path: string;
  size: number;
  mtime: string | null;
  hash: string | null;
  syncState: FileSyncState | null;
  lastSyncedHash: string | null;
  chunkSize: number;
  chunks: TransferChunk[];
  peers: Record<string, PeerFileState>;
}

export interface Transfer {
  id: string;
  peerId: string;
  peerName: string;
  folderId: number;
  folderName: string;
  relPath: string;
  direction: TransferDirection;
  size: number;
  transferred: number;
  progressPct: number;
  speedBps: number;
  etaSeconds: number | null;
  status: TransferStatus;
  chunkSize: number;
  chunksTotal: number;
  chunksDone: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface TransferDetail {
  transfer: Transfer;
  chunks: TransferChunk[];
}

export interface SyncPlanAction {
  relPath: string;
  state: PlanActionState;
  direction: TransferDirection;
  size: number | null;
  localHash: string | null;
  remoteHash: string | null;
  lastSyncedHash: string | null;
}

export interface SyncPlanSummary {
  total: number;
  pull: number;
  push: number;
  deleteLocal: number;
  deleteRemote: number;
  conflicts: number;
  unchanged: number;
}

export interface SyncPlan {
  peer: { peerId: string; name: string };
  folder: FolderRef;
  generatedAt: string;
  summary: SyncPlanSummary;
  actions: SyncPlanAction[];
}

export interface SyncSession {
  id: string;
  peerId: string;
  peerName: string;
  folderId: number;
  folderName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  transferred: number;
  filesTransferred: number;
  error: string | null;
}

export interface Conflict {
  id: number;
  folderId: number;
  folderName: string;
  relPath: string;
  localHash: string | null;
  remoteHash: string | null;
  localSize: number | null;
  remoteSize: number | null;
  localMtime: string | null;
  remoteMtime: string | null;
  remotePeerId: string;
  remotePeerName: string;
  status: ConflictStatus;
  resolution: ConflictResolution | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AgentEvent {
  id: number;
  type: EventType;
  severity: EventSeverity;
  message: string;
  data: Record<string, unknown> | null;
  ts: string;
}

export interface Settings {
  deviceName: string;
  bandwidthLimitBps: number;
  concurrentTransfers: number;
  chunkSizeBytes: number;
  discoveryEnabled: boolean;
  skipHiddenFiles: boolean;
  autoSyncSeconds: number;
}

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------

export interface PeersResponse {
  peers: Peer[];
}

export interface PeerResponse {
  peer: Peer;
}

export interface DiscoveryScanResponse {
  found: DiscoveredPeerInfo[];
}

export interface FoldersResponse {
  folders: Folder[];
}

export interface FolderResponse {
  folder: Folder;
}

export interface RescanResponse {
  folder: Folder;
  scanned: number;
  changed: number;
  removed: number;
  durationMs: number;
}

export interface FilesResponse {
  folder: FolderRef;
  path: string;
  entries: FileEntry[];
}

export interface SyncRunResponse {
  sessionId: string;
  plan: SyncPlan;
}

export interface SessionsResponse {
  sessions: SyncSession[];
}

export interface TransfersResponse {
  transfers: Transfer[];
}

export interface TransferResponse {
  transfer: Transfer;
}

export interface ConflictsResponse {
  conflicts: Conflict[];
}

export interface ConflictResponse {
  conflict: Conflict;
}

export interface EventsResponse {
  events: AgentEvent[];
}

// ---------------------------------------------------------------------------
// WebSocket frames
// ---------------------------------------------------------------------------

export type WsFrame =
  | { kind: "hello"; device: DeviceInfo; ts: string }
  | { kind: "event"; event: AgentEvent }
  | { kind: "transfer"; transfer: Transfer }
  | { kind: "peers"; peers: Peer[] }
  | { kind: "device"; device: DeviceInfo }
  | { kind: "pong" };

export type WsClientMessage = { kind: "ping" };

// ---------------------------------------------------------------------------
// Web backend models (Next.js API routes)
// ---------------------------------------------------------------------------

export interface AgentEndpointInfo {
  id: number;
  label: string;
  port: number;
  createdAt: string;
}

export interface ClientPrefInfo {
  clientId: string;
  language: string | null;
  theme: string | null;
  updatedAt: string;
}
