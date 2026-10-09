/// Small formatting helpers shared by widgets and screens.
///
/// Pure functions, no dependencies — localization-sensitive pieces take the
/// [AppStrings] instance as a parameter.
library;

import '../l10n/strings.dart';
import '../models/models.dart';

const int _kib = 1024;

/// `1234` → `1.2 KB` (binary prefixes, one decimal).
String formatBytes(int? bytes) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes < _kib) return '$bytes B';
  final kb = bytes / _kib;
  if (kb < _kib) return '${_one(kb)} KB';
  final mb = kb / _kib;
  if (mb < _kib) return '${_one(mb)} MB';
  final gb = mb / _kib;
  if (gb < _kib) return '${_one(gb)} GB';
  return '${_one(gb / _kib)} TB';
}

/// `5242880` → `5.0 MB/s`.
String formatSpeed(int bps) {
  if (bps <= 0) return '';
  return '${formatBytes(bps)}/s';
}

String _one(double v) {
  final s = v.toStringAsFixed(1);
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}

/// Compact duration: `25s`, `2m 05s`, `1h 03m`, `2d 4h`. `null` → `—`.
String formatEta(int? seconds) {
  if (seconds == null || seconds < 0) return '—';
  if (seconds < 60) return '${seconds}s';
  final m = seconds ~/ 60;
  if (m < 60) {
    final s = seconds % 60;
    return s == 0 ? '${m}m' : '${m}m ${s.toString().padLeft(2, '0')}s';
  }
  final h = m ~/ 60;
  if (h < 24) {
    final mm = m % 60;
    return mm == 0 ? '${h}h' : '${h}h ${mm.toString().padLeft(2, '0')}m';
  }
  final d = h ~/ 24;
  return '$d d ${h % 24}h';
}

/// Uptime formatting: `1284` → `21m 24s`.
String formatUptime(int seconds) => formatEta(seconds);

/// RFC 3339 → `2026-10-08 10:02` (UTC, device-local rendering is not needed
/// for a LAN tool). Invalid / missing input → `—`.
String formatTimestamp(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final dt = DateTime.tryParse(iso);
  if (dt == null) return '—';
  final utc = dt.toUtc();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${utc.year}-'
      '${two(utc.month)}-'
      '${two(utc.day)} '
      '${two(utc.hour)}:'
      '${two(utc.minute)}';
}

/// Short hash rendering: first 8 hex chars.
String shortHash(String? hash) {
  if (hash == null || hash.isEmpty) return '—';
  return hash.length <= 8 ? hash : hash.substring(0, 8);
}

/// Short peer id rendering: first 8 hex chars.
String shortPeerId(String peerId) => shortHash(peerId);

/// Locale-aware relative time against the wall clock (test-overridable).
String relativeTime(String? iso, AppStrings strings, {DateTime? now}) {
  if (iso == null || iso.isEmpty) return strings.neverSeen;
  final dt = DateTime.tryParse(iso);
  if (dt == null) return strings.neverSeen;
  final reference = (now ?? DateTime.now()).toUtc();
  final dtUtc = dt.toUtc();
  final diff = reference.difference(dtUtc);
  if (diff.isNegative) return strings.justNow;
  final minutes = diff.inMinutes;
  if (minutes < 1) return strings.justNow;
  if (minutes < 60) return strings.minutesAgo(minutes);
  final hours = diff.inHours;
  if (hours < 24) return strings.hoursAgo(hours);
  final days = diff.inDays;
  if (days < 30) return strings.daysAgo(days);
  return formatTimestamp(iso);
}

/// Labels for every file sync state.
String fileSyncStateLabel(FileSyncState? state, AppStrings strings) {
  switch (state) {
    case FileSyncState.synced:
      return strings.syncSynced;
    case FileSyncState.pending:
      return strings.syncPending;
    case FileSyncState.syncing:
      return strings.syncSyncing;
    case FileSyncState.conflict:
      return strings.syncConflict;
    case FileSyncState.localOnly:
      return strings.syncLocalOnly;
    case null:
      return strings.neverIndexed;
  }
}

/// Labels for every transfer status.
String transferStatusLabel(TransferStatus status, AppStrings strings) {
  switch (status) {
    case TransferStatus.queued:
      return strings.statusQueued;
    case TransferStatus.preparing:
      return strings.statusPreparing;
    case TransferStatus.transferring:
      return strings.statusTransferring;
    case TransferStatus.verifying:
      return strings.statusVerifying;
    case TransferStatus.paused:
      return strings.statusPaused;
    case TransferStatus.completed:
      return strings.statusCompleted;
    case TransferStatus.failed:
      return strings.statusFailed;
    case TransferStatus.cancelled:
      return strings.statusCancelled;
  }
}

/// Labels for every trust level.
String trustLabel(TrustLevel trust, AppStrings strings) {
  switch (trust) {
    case TrustLevel.discovered:
      return strings.trustDiscovered;
    case TrustLevel.pairing:
      return strings.trustPairing;
    case TrustLevel.trusted:
      return strings.trustTrusted;
    case TrustLevel.revoked:
      return strings.trustRevoked;
  }
}

/// Labels for every plan action state.
String planActionLabel(PlanActionState state, AppStrings strings) {
  switch (state) {
    case PlanActionState.unchanged:
      return strings.actionUnchanged;
    case PlanActionState.localOnly:
      return strings.actionLocalOnly;
    case PlanActionState.remoteOnly:
      return strings.actionRemoteOnly;
    case PlanActionState.localModified:
      return strings.actionLocalModified;
    case PlanActionState.remoteModified:
      return strings.actionRemoteModified;
    case PlanActionState.conflict:
      return strings.actionConflict;
    case PlanActionState.deleteLocal:
      return strings.actionDeleteLocal;
    case PlanActionState.deleteRemote:
      return strings.actionDeleteRemote;
  }
}

/// Labels for transfer directions (NONE → empty string).
String directionLabel(TransferDirection direction, AppStrings strings) {
  switch (direction) {
    case TransferDirection.push:
      return strings.directionPush;
    case TransferDirection.pull:
      return strings.directionPull;
    case TransferDirection.none:
      return '';
  }
}
