/// Typed models for the MeshSync agent API v1 (docs/API.md).
///
/// Every model exposes a defensive `fromJson` factory: wrong shapes and
/// missing fields degrade to defaults instead of throwing, because a client
/// must never crash on a slightly different agent build.
library;

import 'enums.dart';

export 'enums.dart';

// ---------------------------------------------------------------------------
// Health & device
// ---------------------------------------------------------------------------

/// `GET /api/v1/health`
class Health {
  const Health({
    required this.status,
    required this.version,
    required this.uptimeSeconds,
    required this.dbOk,
  });

  factory Health.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Health(
      status: parseString(map['status'], fallback: 'unknown'),
      version: parseString(map['version']),
      uptimeSeconds: parseInt(map['uptimeSeconds']),
      dbOk: parseBool(map['dbOk']),
    );
  }

  final String status;
  final String version;
  final int uptimeSeconds;
  final bool dbOk;

  Map<String, dynamic> toJson() => {
        'status': status,
        'version': version,
        'uptimeSeconds': uptimeSeconds,
        'dbOk': dbOk,
      };
}

/// `stats` block of `GET /api/v1/device`.
class DeviceStats {
  const DeviceStats({
    required this.folders,
    required this.filesIndexed,
    required this.bytesIndexed,
    required this.peersTrusted,
    required this.peersOnline,
    required this.transfersActive,
    required this.transfersCompleted,
    required this.conflictsOpen,
    required this.lastSyncAt,
  });

  factory DeviceStats.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return DeviceStats(
      folders: parseInt(map['folders']),
      filesIndexed: parseInt(map['filesIndexed']),
      bytesIndexed: parseInt(map['bytesIndexed']),
      peersTrusted: parseInt(map['peersTrusted']),
      peersOnline: parseInt(map['peersOnline']),
      transfersActive: parseInt(map['transfersActive']),
      transfersCompleted: parseInt(map['transfersCompleted']),
      conflictsOpen: parseInt(map['conflictsOpen']),
      lastSyncAt: parseStringOrNull(map['lastSyncAt']),
    );
  }

  final int folders;
  final int filesIndexed;
  final int bytesIndexed;
  final int peersTrusted;
  final int peersOnline;
  final int transfersActive;
  final int transfersCompleted;
  final int conflictsOpen;
  final String? lastSyncAt;
}

/// `GET /api/v1/device`
class DeviceInfo {
  const DeviceInfo({
    required this.peerId,
    required this.name,
    required this.version,
    required this.platform,
    required this.startedAt,
    required this.apiPort,
    required this.peerPort,
    required this.keyFingerprint,
    required this.nativeEngine,
    required this.stats,
  });

  factory DeviceInfo.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return DeviceInfo(
      peerId: parseString(map['peerId']),
      name: parseString(map['name']),
      version: parseString(map['version']),
      platform: parseString(map['platform']),
      startedAt: parseString(map['startedAt']),
      apiPort: parseInt(map['apiPort']),
      peerPort: parseInt(map['peerPort']),
      keyFingerprint: parseString(map['keyFingerprint']),
      nativeEngine: parseString(map['nativeEngine']),
      stats: DeviceStats.fromJson(map['stats']),
    );
  }

  final String peerId;
  final String name;
  final String version;
  final String platform;
  final String startedAt;
  final int apiPort;
  final int peerPort;
  final String keyFingerprint;
  final String nativeEngine;
  final DeviceStats stats;
}

// ---------------------------------------------------------------------------
// Peers
// ---------------------------------------------------------------------------

/// Entry of `GET /api/v1/peers` → `peers[]`.
class Peer {
  const Peer({
    required this.peerId,
    required this.name,
    required this.address,
    required this.trust,
    required this.online,
    required this.version,
    required this.platform,
    required this.lastSeen,
    required this.addedAt,
    required this.sharedFolders,
  });

  factory Peer.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Peer(
      peerId: parseString(map['peerId']),
      name: parseString(map['name']),
      address: parseString(map['address']),
      trust: TrustLevel.parse(map['trust']),
      online: parseBool(map['online']),
      version: parseString(map['version']),
      platform: parseString(map['platform']),
      lastSeen: parseStringOrNull(map['lastSeen']),
      addedAt: parseString(map['addedAt']),
      sharedFolders: parseInt(map['sharedFolders']),
    );
  }

  final String peerId;
  final String name;
  final String address;
  final TrustLevel trust;
  final bool online;
  final String version;
  final String platform;
  final String? lastSeen;
  final String addedAt;
  final int sharedFolders;
}

/// Entry of `POST /api/v1/discovery/scan` → `found[]`.
class DiscoveredPeer {
  const DiscoveredPeer({
    required this.peerId,
    required this.name,
    required this.address,
    required this.version,
  });

  factory DiscoveredPeer.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return DiscoveredPeer(
      peerId: parseString(map['peerId']),
      name: parseString(map['name']),
      address: parseString(map['address']),
      version: parseString(map['version']),
    );
  }

  final String peerId;
  final String name;
  final String address;
  final String version;
}

// ---------------------------------------------------------------------------
// Shared folders
// ---------------------------------------------------------------------------

/// `{ "id": 1, "name": "Documents" }` reference inside listings / plans.
class FolderRef {
  const FolderRef({required this.id, required this.name});

  factory FolderRef.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return FolderRef(
      id: parseInt(map['id']),
      name: parseString(map['name']),
    );
  }

  final int id;
  final String name;
}

/// Entry of `GET /api/v1/shared-folders`.
class SharedFolder {
  const SharedFolder({
    required this.id,
    required this.name,
    required this.path,
    required this.fileCount,
    required this.totalBytes,
    required this.lastScanAt,
  });

  factory SharedFolder.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SharedFolder(
      id: parseInt(map['id']),
      name: parseString(map['name']),
      path: parseString(map['path']),
      fileCount: parseInt(map['fileCount']),
      totalBytes: parseInt(map['totalBytes']),
      lastScanAt: parseStringOrNull(map['lastScanAt']),
    );
  }

  final int id;
  final String name;
  final String path;
  final int fileCount;
  final int totalBytes;
  final String? lastScanAt;
}

/// `POST /api/v1/shared-folders/{id}/rescan` result.
class RescanResult {
  const RescanResult({
    required this.folder,
    required this.scanned,
    required this.changed,
    required this.removed,
    required this.durationMs,
  });

  factory RescanResult.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return RescanResult(
      folder: SharedFolder.fromJson(map['folder']),
      scanned: parseInt(map['scanned']),
      changed: parseInt(map['changed']),
      removed: parseInt(map['removed']),
      durationMs: parseInt(map['durationMs']),
    );
  }

  final SharedFolder folder;
  final int scanned;
  final int changed;
  final int removed;
  final int durationMs;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// One entry of `GET /api/v1/files` — either a directory or a file.
/// `isDir` selects which fields are meaningful.
class FileEntry {
  const FileEntry({
    required this.name,
    required this.isDir,
    this.fileCount = 0,
    this.totalBytes = 0,
    this.size = 0,
    this.mtime,
    this.hash,
    this.syncState,
    this.lastSyncedHash,
    this.remotePeers = const <String>[],
  });

  factory FileEntry.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final isDir = map['type'] == 'dir';
    final peersRaw = map['remotePeers'];
    return FileEntry(
      name: parseString(map['name']),
      isDir: isDir,
      fileCount: parseInt(map['fileCount']),
      totalBytes: parseInt(map['totalBytes']),
      size: parseInt(map['size']),
      mtime: parseStringOrNull(map['mtime']),
      hash: parseStringOrNull(map['hash']),
      syncState: FileSyncState.tryParse(map['syncState']),
      lastSyncedHash: parseStringOrNull(map['lastSyncedHash']),
      remotePeers: peersRaw is List
          ? peersRaw.map((e) => parseString(e)).where((e) => e.isNotEmpty).toList()
          : const <String>[],
    );
  }

  final String name;
  final bool isDir;

  /// Directory-only: number of files inside (recursive).
  final int fileCount;

  /// Directory-only: recursive byte size.
  final int totalBytes;

  /// File-only: size in bytes.
  final int size;

  /// File-only: modification time (RFC 3339).
  final String? mtime;

  /// File-only: lowercase hex SHA-256 of current content.
  final String? hash;

  /// File-only: sync state, null when the agent does not know it yet.
  final FileSyncState? syncState;

  /// File-only: hash of the last synced content, null if never synced.
  final String? lastSyncedHash;

  /// File-only: peer IDs holding an up-to-date copy.
  final List<String> remotePeers;
}

/// `GET /api/v1/files` response.
class FilesListing {
  const FilesListing({
    required this.folder,
    required this.path,
    required this.entries,
  });

  factory FilesListing.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final entriesRaw = map['entries'];
    return FilesListing(
      folder: FolderRef.fromJson(map['folder']),
      path: parseString(map['path']),
      entries: entriesRaw is List
          ? entriesRaw.map(FileEntry.fromJson).toList()
          : <FileEntry>[],
    );
  }

  final FolderRef folder;
  final String path;
  final List<FileEntry> entries;
}

/// Per-peer knowledge about one file (files/detail `peers` map).
class PeerFileState {
  const PeerFileState({this.hash, this.size, this.mtime, this.seenAt});

  factory PeerFileState.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return PeerFileState(
      hash: parseStringOrNull(map['hash']),
      size: parseIntOrNull(map['size']),
      mtime: parseStringOrNull(map['mtime']),
      seenAt: parseStringOrNull(map['seenAt']),
    );
  }

  final String? hash;
  final int? size;
  final String? mtime;
  final String? seenAt;
}

/// `GET /api/v1/files/detail` (and POST /api/v1/files) response.
class FileDetail {
  const FileDetail({
    required this.name,
    required this.folder,
    required this.path,
    required this.size,
    required this.mtime,
    required this.hash,
    required this.syncState,
    required this.lastSyncedHash,
    required this.chunkSize,
    required this.chunks,
    required this.peers,
  });

  factory FileDetail.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final chunksRaw = map['chunks'];
    final peersRaw = map['peers'];
    final peers = <String, PeerFileState>{};
    if (peersRaw is Map) {
      peersRaw.forEach((key, value) {
        final k = parseString(key);
        if (k.isNotEmpty) peers[k] = PeerFileState.fromJson(value);
      });
    }
    return FileDetail(
      name: parseString(map['name']),
      folder: FolderRef.fromJson(map['folder']),
      path: parseString(map['path']),
      size: parseInt(map['size']),
      mtime: parseStringOrNull(map['mtime']),
      hash: parseStringOrNull(map['hash']),
      syncState: FileSyncState.tryParse(map['syncState']),
      lastSyncedHash: parseStringOrNull(map['lastSyncedHash']),
      chunkSize: parseInt(map['chunkSize']),
      chunks: chunksRaw is List
          ? chunksRaw.map(TransferChunk.fromJson).toList()
          : <TransferChunk>[],
      peers: peers,
    );
  }

  final String name;
  final FolderRef folder;
  final String path;
  final int size;
  final String? mtime;
  final String? hash;
  final FileSyncState? syncState;
  final String? lastSyncedHash;
  final int chunkSize;
  final List<TransferChunk> chunks;
  final Map<String, PeerFileState> peers;
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/// Chunk descriptor shared by transfers and file details.
class TransferChunk {
  const TransferChunk({
    required this.index,
    required this.size,
    required this.state,
  });

  factory TransferChunk.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return TransferChunk(
      index: parseInt(map['index']),
      size: parseInt(map['size']),
      state: ChunkState.parse(map['state']),
    );
  }

  final int index;
  final int size;
  final ChunkState state;
}

/// Entry of `GET /api/v1/transfers`.
class Transfer {
  const Transfer({
    required this.id,
    required this.peerId,
    required this.peerName,
    required this.folderId,
    required this.folderName,
    required this.relPath,
    required this.direction,
    required this.size,
    required this.transferred,
    required this.progressPct,
    required this.speedBps,
    required this.etaSeconds,
    required this.status,
    required this.chunkSize,
    required this.chunksTotal,
    required this.chunksDone,
    required this.startedAt,
    required this.completedAt,
    required this.error,
  });

  factory Transfer.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Transfer(
      id: parseString(map['id']),
      peerId: parseString(map['peerId']),
      peerName: parseString(map['peerName']),
      folderId: parseInt(map['folderId']),
      folderName: parseString(map['folderName']),
      relPath: parseString(map['relPath']),
      direction: TransferDirection.parse(map['direction']),
      size: parseInt(map['size']),
      transferred: parseInt(map['transferred']),
      progressPct: parseInt(map['progressPct']).clamp(0, 100),
      speedBps: parseInt(map['speedBps']),
      etaSeconds: parseIntOrNull(map['etaSeconds']),
      status: TransferStatus.parse(map['status']),
      chunkSize: parseInt(map['chunkSize']),
      chunksTotal: parseInt(map['chunksTotal']),
      chunksDone: parseInt(map['chunksDone']),
      startedAt: parseStringOrNull(map['startedAt']),
      completedAt: parseStringOrNull(map['completedAt']),
      error: parseStringOrNull(map['error']),
    );
  }

  final String id;
  final String peerId;
  final String peerName;
  final int folderId;
  final String folderName;
  final String relPath;
  final TransferDirection direction;
  final int size;
  final int transferred;
  final int progressPct;
  final int speedBps;
  final int? etaSeconds;
  final TransferStatus status;
  final int chunkSize;
  final int chunksTotal;
  final int chunksDone;
  final String? startedAt;
  final String? completedAt;
  final String? error;

  /// Basename of the relative path (forward-slash safe on all platforms).
  String get basename =>
      relPath.contains('/') ? relPath.split('/').last : relPath;
}

/// `GET /api/v1/transfers/{id}` response.
class TransferDetail {
  const TransferDetail({required this.transfer, required this.chunks});

  factory TransferDetail.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final chunksRaw = map['chunks'];
    return TransferDetail(
      transfer: Transfer.fromJson(map['transfer']),
      chunks: chunksRaw is List
          ? chunksRaw.map(TransferChunk.fromJson).toList()
          : <TransferChunk>[],
    );
  }

  final Transfer transfer;
  final List<TransferChunk> chunks;
}

// ---------------------------------------------------------------------------
// Sync plans & sessions
// ---------------------------------------------------------------------------

/// One classified path of a sync plan.
class SyncPlanAction {
  const SyncPlanAction({
    required this.relPath,
    required this.state,
    required this.direction,
    required this.size,
    required this.localHash,
    required this.remoteHash,
    required this.lastSyncedHash,
  });

  factory SyncPlanAction.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SyncPlanAction(
      relPath: parseString(map['relPath']),
      state: PlanActionState.parse(map['state']),
      direction: TransferDirection.parse(map['direction']),
      size: parseIntOrNull(map['size']),
      localHash: parseStringOrNull(map['localHash']),
      remoteHash: parseStringOrNull(map['remoteHash']),
      lastSyncedHash: parseStringOrNull(map['lastSyncedHash']),
    );
  }

  final String relPath;
  final PlanActionState state;
  final TransferDirection direction;
  final int? size;
  final String? localHash;
  final String? remoteHash;
  final String? lastSyncedHash;
}

/// Aggregated counters of a sync plan.
class SyncPlanSummary {
  const SyncPlanSummary({
    required this.total,
    required this.pull,
    required this.push,
    required this.deleteLocal,
    required this.deleteRemote,
    required this.conflicts,
    required this.unchanged,
  });

  factory SyncPlanSummary.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SyncPlanSummary(
      total: parseInt(map['total']),
      pull: parseInt(map['pull']),
      push: parseInt(map['push']),
      deleteLocal: parseInt(map['deleteLocal']),
      deleteRemote: parseInt(map['deleteRemote']),
      conflicts: parseInt(map['conflicts']),
      unchanged: parseInt(map['unchanged']),
    );
  }

  final int total;
  final int pull;
  final int push;
  final int deleteLocal;
  final int deleteRemote;
  final int conflicts;
  final int unchanged;
}

/// `GET /api/v1/sync/plan` response.
class SyncPlan {
  const SyncPlan({
    required this.peerId,
    required this.peerName,
    required this.folder,
    required this.generatedAt,
    required this.summary,
    required this.actions,
  });

  factory SyncPlan.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final peerRaw = map['peer'];
    final actionsRaw = map['actions'];
    return SyncPlan(
      peerId: parseString(
        peerRaw is Map ? peerRaw['peerId'] : null,
      ),
      peerName: parseString(peerRaw is Map ? peerRaw['name'] : null),
      folder: FolderRef.fromJson(map['folder']),
      generatedAt: parseString(map['generatedAt']),
      summary: SyncPlanSummary.fromJson(map['summary']),
      actions: actionsRaw is List
          ? actionsRaw.map(SyncPlanAction.fromJson).toList()
          : <SyncPlanAction>[],
    );
  }

  final String peerId;
  final String peerName;
  final FolderRef folder;
  final String generatedAt;
  final SyncPlanSummary summary;
  final List<SyncPlanAction> actions;
}

/// `POST /api/v1/sync/run` response.
class SyncRunResult {
  const SyncRunResult({required this.sessionId, required this.plan});

  factory SyncRunResult.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SyncRunResult(
      sessionId: parseString(map['sessionId']),
      plan: SyncPlan.fromJson(map['plan']),
    );
  }

  final String sessionId;
  final SyncPlan plan;
}

/// Entry of `GET /api/v1/sync/sessions`.
class SyncSession {
  const SyncSession({
    required this.id,
    required this.peerId,
    required this.peerName,
    required this.folderId,
    required this.folderName,
    required this.startedAt,
    required this.finishedAt,
    required this.status,
    required this.transferred,
    required this.filesTransferred,
    required this.error,
  });

  factory SyncSession.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SyncSession(
      id: parseString(map['id']),
      peerId: parseString(map['peerId']),
      peerName: parseString(map['peerName']),
      folderId: parseInt(map['folderId']),
      folderName: parseString(map['folderName']),
      startedAt: parseString(map['startedAt']),
      finishedAt: parseStringOrNull(map['finishedAt']),
      status: parseString(map['status']),
      transferred: parseInt(map['transferred']),
      filesTransferred: parseInt(map['filesTransferred']),
      error: parseStringOrNull(map['error']),
    );
  }

  final String id;
  final String peerId;
  final String peerName;
  final int folderId;
  final String folderName;
  final String startedAt;
  final String? finishedAt;
  final String status;
  final int transferred;
  final int filesTransferred;
  final String? error;
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/// Entry of `GET /api/v1/conflicts`.
class Conflict {
  const Conflict({
    required this.id,
    required this.folderId,
    required this.folderName,
    required this.relPath,
    required this.localHash,
    required this.remoteHash,
    required this.localSize,
    required this.remoteSize,
    required this.localMtime,
    required this.remoteMtime,
    required this.remotePeerId,
    required this.remotePeerName,
    required this.status,
    required this.resolution,
    required this.createdAt,
    required this.resolvedAt,
  });

  factory Conflict.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Conflict(
      id: parseInt(map['id']),
      folderId: parseInt(map['folderId']),
      folderName: parseString(map['folderName']),
      relPath: parseString(map['relPath']),
      localHash: parseStringOrNull(map['localHash']),
      remoteHash: parseStringOrNull(map['remoteHash']),
      localSize: parseIntOrNull(map['localSize']),
      remoteSize: parseIntOrNull(map['remoteSize']),
      localMtime: parseStringOrNull(map['localMtime']),
      remoteMtime: parseStringOrNull(map['remoteMtime']),
      remotePeerId: parseString(map['remotePeerId']),
      remotePeerName: parseString(map['remotePeerName']),
      status: ConflictStatus.parse(map['status']),
      resolution: _parseResolution(map['resolution']),
      createdAt: parseString(map['createdAt']),
      resolvedAt: parseStringOrNull(map['resolvedAt']),
    );
  }

  static ConflictResolution? _parseResolution(dynamic raw) {
    if (raw is! String) return null;
    for (final v in ConflictResolution.values) {
      if (v.wireName == raw) return v;
    }
    return null;
  }

  final int id;
  final int folderId;
  final String folderName;
  final String relPath;
  final String? localHash;
  final String? remoteHash;
  final int? localSize;
  final int? remoteSize;
  final String? localMtime;
  final String? remoteMtime;
  final String remotePeerId;
  final String remotePeerName;
  final ConflictStatus status;
  final ConflictResolution? resolution;
  final String createdAt;
  final String? resolvedAt;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Entry of `GET /api/v1/events` and `event` WebSocket frames.
class AgentEvent {
  const AgentEvent({
    required this.id,
    required this.type,
    required this.severity,
    required this.message,
    required this.data,
    required this.ts,
  });

  factory AgentEvent.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return AgentEvent(
      id: parseInt(map['id']),
      type: parseString(map['type']),
      severity: EventSeverity.parse(map['severity']),
      message: parseString(map['message']),
      data: map['data'] is Map<String, dynamic> ? map['data'] : null,
      ts: parseString(map['ts']),
    );
  }

  final int id;
  final String type;
  final EventSeverity severity;
  final String message;
  final Map<String, dynamic>? data;
  final String ts;
}

// ---------------------------------------------------------------------------
// Agent settings
// ---------------------------------------------------------------------------

/// `GET/PUT /api/v1/settings`.
class AgentSettings {
  const AgentSettings({
    required this.deviceName,
    required this.bandwidthLimitBps,
    required this.concurrentTransfers,
    required this.chunkSizeBytes,
    required this.discoveryEnabled,
    required this.skipHiddenFiles,
    required this.autoSyncSeconds,
  });

  factory AgentSettings.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return AgentSettings(
      deviceName: parseString(map['deviceName']),
      bandwidthLimitBps: parseInt(map['bandwidthLimitBps']),
      concurrentTransfers: parseInt(map['concurrentTransfers']),
      chunkSizeBytes: parseInt(map['chunkSizeBytes']),
      discoveryEnabled: parseBool(map['discoveryEnabled']),
      skipHiddenFiles: parseBool(map['skipHiddenFiles']),
      autoSyncSeconds: parseInt(map['autoSyncSeconds']),
    );
  }

  final String deviceName;
  final int bandwidthLimitBps;
  final int concurrentTransfers;
  final int chunkSizeBytes;
  final bool discoveryEnabled;
  final bool skipHiddenFiles;
  final int autoSyncSeconds;

  Map<String, dynamic> toJson() => {
        'deviceName': deviceName,
        'bandwidthLimitBps': bandwidthLimitBps,
        'concurrentTransfers': concurrentTransfers,
        'chunkSizeBytes': chunkSizeBytes,
        'discoveryEnabled': discoveryEnabled,
        'skipHiddenFiles': skipHiddenFiles,
        'autoSyncSeconds': autoSyncSeconds,
      };
}

// ---------------------------------------------------------------------------
// WebSocket frames (GET /api/v1/events/ws)
// ---------------------------------------------------------------------------

/// Parsed server→client WebSocket frame.
sealed class WsFrame {
  const WsFrame();

  factory WsFrame.fromJson(dynamic raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    switch (map['kind']) {
      case 'hello':
        return WsHello(DeviceInfo.fromJson(map['device']), parseString(map['ts']));
      case 'event':
        return WsEventFrame(AgentEvent.fromJson(map['event']));
      case 'transfer':
        return WsTransferFrame(Transfer.fromJson(map['transfer']));
      case 'peers':
        final peers = map['peers'];
        return WsPeersFrame(
          peers is List ? peers.map(Peer.fromJson).toList() : <Peer>[],
        );
      case 'device':
        return WsDeviceFrame(DeviceInfo.fromJson(map['device']));
      case 'pong':
        return const WsPong();
    }
    return WsUnknown(parseString(map['kind'], fallback: '?'));
  }
}

class WsHello extends WsFrame {
  const WsHello(this.device, this.ts);
  final DeviceInfo device;
  final String ts;
}

class WsEventFrame extends WsFrame {
  const WsEventFrame(this.event);
  final AgentEvent event;
}

class WsTransferFrame extends WsFrame {
  const WsTransferFrame(this.transfer);
  final Transfer transfer;
}

class WsPeersFrame extends WsFrame {
  const WsPeersFrame(this.peers);
  final List<Peer> peers;
}

class WsDeviceFrame extends WsFrame {
  const WsDeviceFrame(this.device);
  final DeviceInfo device;
}

class WsPong extends WsFrame {
  const WsPong();
}

/// Forward-compatible carrier for unknown frame kinds.
class WsUnknown extends WsFrame {
  const WsUnknown(this.kind);
  final String kind;
}
