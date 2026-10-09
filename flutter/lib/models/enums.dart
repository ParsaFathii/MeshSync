/// Enumerations of the MeshSync agent API v1 (docs/API.md).
///
/// Every enum parses its wire (upper-case) name defensively: unknown or
/// missing values never throw — they fall back to a safe default.
library;

/// Peer trust: `DISCOVERED`, `PAIRING`, `TRUSTED`, `REVOKED`.
enum TrustLevel {
  discovered('DISCOVERED'),
  pairing('PAIRING'),
  trusted('TRUSTED'),
  revoked('REVOKED');

  const TrustLevel(this.wireName);
  final String wireName;

  static TrustLevel parse(String? raw) {
    switch (raw) {
      case 'DISCOVERED':
        return TrustLevel.discovered;
      case 'PAIRING':
        return TrustLevel.pairing;
      case 'TRUSTED':
        return TrustLevel.trusted;
      case 'REVOKED':
        return TrustLevel.revoked;
    }
    return TrustLevel.discovered;
  }
}

/// Transfer status: `QUEUED`, `PREPARING`, `TRANSFERRING`, `VERIFYING`,
/// `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`.
enum TransferStatus {
  queued('QUEUED'),
  preparing('PREPARING'),
  transferring('TRANSFERRING'),
  verifying('VERIFYING'),
  paused('PAUSED'),
  completed('COMPLETED'),
  failed('FAILED'),
  cancelled('CANCELLED');

  const TransferStatus(this.wireName);
  final String wireName;

  static TransferStatus parse(String? raw) {
    switch (raw) {
      case 'QUEUED':
        return TransferStatus.queued;
      case 'PREPARING':
        return TransferStatus.preparing;
      case 'TRANSFERRING':
        return TransferStatus.transferring;
      case 'VERIFYING':
        return TransferStatus.verifying;
      case 'PAUSED':
        return TransferStatus.paused;
      case 'COMPLETED':
        return TransferStatus.completed;
      case 'FAILED':
        return TransferStatus.failed;
      case 'CANCELLED':
        return TransferStatus.cancelled;
    }
    return TransferStatus.queued;
  }

  /// Transfers that are started but not finished — candidates for
  /// pause/cancel UI affordances.
  bool get isActive =>
      this == TransferStatus.queued ||
      this == TransferStatus.preparing ||
      this == TransferStatus.transferring ||
      this == TransferStatus.verifying ||
      this == TransferStatus.paused;

  bool get isTerminal =>
      this == TransferStatus.completed ||
      this == TransferStatus.failed ||
      this == TransferStatus.cancelled;
}

/// Transfer direction: `PUSH` (this device sends), `PULL` (this device
/// receives), and `NONE` used by sync plan actions that transfer nothing.
enum TransferDirection {
  push('PUSH'),
  pull('PULL'),
  none('NONE');

  const TransferDirection(this.wireName);
  final String wireName;

  static TransferDirection parse(String? raw) {
    switch (raw) {
      case 'PUSH':
        return TransferDirection.push;
      case 'PULL':
        return TransferDirection.pull;
      case 'NONE':
        return TransferDirection.none;
    }
    return TransferDirection.none;
  }
}

/// File sync state: `SYNCED`, `PENDING`, `SYNCING`, `CONFLICT`,
/// `LOCAL_ONLY`.
enum FileSyncState {
  synced('SYNCED'),
  pending('PENDING'),
  syncing('SYNCING'),
  conflict('CONFLICT'),
  localOnly('LOCAL_ONLY');

  const FileSyncState(this.wireName);
  final String wireName;

  static FileSyncState? tryParse(String? raw) {
    switch (raw) {
      case 'SYNCED':
        return FileSyncState.synced;
      case 'PENDING':
        return FileSyncState.pending;
      case 'SYNCING':
        return FileSyncState.syncing;
      case 'CONFLICT':
        return FileSyncState.conflict;
      case 'LOCAL_ONLY':
        return FileSyncState.localOnly;
    }
    return null;
  }
}

/// Sync plan action state: `UNCHANGED`, `LOCAL_ONLY`, `REMOTE_ONLY`,
/// `LOCAL_MODIFIED`, `REMOTE_MODIFIED`, `CONFLICT`, `DELETE_LOCAL`,
/// `DELETE_REMOTE`.
enum PlanActionState {
  unchanged('UNCHANGED'),
  localOnly('LOCAL_ONLY'),
  remoteOnly('REMOTE_ONLY'),
  localModified('LOCAL_MODIFIED'),
  remoteModified('REMOTE_MODIFIED'),
  conflict('CONFLICT'),
  deleteLocal('DELETE_LOCAL'),
  deleteRemote('DELETE_REMOTE');

  const PlanActionState(this.wireName);
  final String wireName;

  static PlanActionState parse(String? raw) {
    switch (raw) {
      case 'UNCHANGED':
        return PlanActionState.unchanged;
      case 'LOCAL_ONLY':
        return PlanActionState.localOnly;
      case 'REMOTE_ONLY':
        return PlanActionState.remoteOnly;
      case 'LOCAL_MODIFIED':
        return PlanActionState.localModified;
      case 'REMOTE_MODIFIED':
        return PlanActionState.remoteModified;
      case 'CONFLICT':
        return PlanActionState.conflict;
      case 'DELETE_LOCAL':
        return PlanActionState.deleteLocal;
      case 'DELETE_REMOTE':
        return PlanActionState.deleteRemote;
    }
    return PlanActionState.unchanged;
  }
}

/// Conflict status: `OPEN`, `RESOLVED`.
enum ConflictStatus {
  open('OPEN'),
  resolved('RESOLVED');

  const ConflictStatus(this.wireName);
  final String wireName;

  static ConflictStatus parse(String? raw) =>
      raw == 'RESOLVED' ? ConflictStatus.resolved : ConflictStatus.open;
}

/// Conflict resolution action: `KEEP_LOCAL`, `KEEP_REMOTE`, `KEEP_BOTH`,
/// `LATER`.
enum ConflictResolution {
  keepLocal('KEEP_LOCAL'),
  keepRemote('KEEP_REMOTE'),
  keepBoth('KEEP_BOTH'),
  later('LATER');

  const ConflictResolution(this.wireName);
  final String wireName;

  String toJson() => wireName;
}

/// Event severity: `INFO`, `WARN`, `ERROR`.
enum EventSeverity {
  info('INFO'),
  warn('WARN'),
  error('ERROR');

  const EventSeverity(this.wireName);
  final String wireName;

  static EventSeverity parse(String? raw) {
    switch (raw) {
      case 'WARN':
        return EventSeverity.warn;
      case 'ERROR':
        return EventSeverity.error;
      case 'INFO':
        return EventSeverity.info;
    }
    return EventSeverity.info;
  }
}

/// Chunk state inside a transfer / file chunk map: `DONE`, `ACTIVE`,
/// `PENDING`, `FAILED`.
enum ChunkState {
  done('DONE'),
  active('ACTIVE'),
  pending('PENDING'),
  failed('FAILED');

  const ChunkState(this.wireName);
  final String wireName;

  static ChunkState parse(String? raw) {
    switch (raw) {
      case 'DONE':
        return ChunkState.done;
      case 'ACTIVE':
        return ChunkState.active;
      case 'PENDING':
        return ChunkState.pending;
      case 'FAILED':
        return ChunkState.failed;
    }
    return ChunkState.pending;
  }
}

/// Transfer lifecycle actions exposed by the agent:
/// `/api/v1/transfers/{id}/pause | /resume | /cancel | /retry`.
enum TransferAction {
  pause('pause'),
  resume('resume'),
  cancel('cancel'),
  retry('retry');

  const TransferAction(this.wireName);
  final String wireName;

  String get pathSegment => wireName;
}

/// Parses an int that may arrive as num, string, or garbage.
int parseInt(dynamic raw, {int fallback = 0}) {
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  if (raw is String) {
    return int.tryParse(raw) ?? fallback;
  }
  return fallback;
}

/// Parses a nullable int; invalid values become null.
int? parseIntOrNull(dynamic raw) {
  if (raw == null) return null;
  if (raw is int) return raw;
  if (raw is num) return raw.toInt();
  if (raw is String) return int.tryParse(raw);
  return null;
}

/// Parses a bool that may arrive as bool or string.
bool parseBool(dynamic raw, {bool fallback = false}) {
  if (raw is bool) return raw;
  if (raw is String) {
    if (raw == 'true') return true;
    if (raw == 'false') return false;
  }
  return fallback;
}

/// Parses a string, never null.
String parseString(dynamic raw, {String fallback = ''}) {
  if (raw is String) return raw;
  return fallback;
}

/// Parses a nullable string.
String? parseStringOrNull(dynamic raw) {
  if (raw is String) return raw;
  return null;
}
