/// Wires the agent WebSocket event stream into the stores.
///
/// Per the API contract: disconnects are expected, the client reconnects with
/// backoff, and after every (re)connection all state is refetched over REST —
/// stale WS state is never trusted. Frame dispatch:
/// * `peers`    → PeersStore.applyPeers
/// * `transfer` → TransfersStore.upsert
/// * `event`    → EventsStore.append (conflict events also refresh conflicts)
/// * `hello`/`device` → ConnectionStore.applyDeviceInfo
library;

import 'dart:async';

import '../api/ws_client.dart';
import '../models/models.dart';
import 'conflicts_store.dart';
import 'connection_store.dart';
import 'events_store.dart';
import 'folders_store.dart';
import 'peers_store.dart';
import 'transfers_store.dart';

class LiveService {
  LiveService({
    required this.connection,
    required this.peers,
    required this.folders,
    required this.transfers,
    required this.conflicts,
    required this.events,
  });

  final ConnectionStore connection;
  final PeersStore peers;
  final FoldersStore folders;
  final TransfersStore transfers;
  final ConflictsStore conflicts;
  final EventsStore events;

  WsClient? _ws;
  StreamSubscription<WsFrame>? _frameSub;
  StreamSubscription<void>? _reconnectSub;
  int _watchedEpoch = -1;
  bool _started = false;

  /// Starts listening; reconnects whenever the agent address changes.
  void start() {
    if (_started) return;
    _started = true;
    _watchedEpoch = connection.apiEpoch;
    connection.addListener(_onConnectionChanged);
    _connect();
  }

  void _onConnectionChanged() {
    if (connection.apiEpoch != _watchedEpoch) {
      _watchedEpoch = connection.apiEpoch;
      _connect();
    }
  }

  void _connect() {
    _teardownWs();
    final ws = WsClient(url: connection.api.webSocketUrl());
    _ws = ws;
    _reconnectSub = ws.reconnected.listen((_) => _refetchAll());
    _frameSub = ws.frames.listen(_dispatch);
    ws.start();
  }

  void _dispatch(WsFrame frame) {
    switch (frame) {
      case WsHello(:final device):
        connection.applyDeviceInfo(device);
      case WsDeviceFrame(:final device):
        connection.applyDeviceInfo(device);
      case WsPeersFrame(:final peers):
        this.peers.applyPeers(peers);
      case WsTransferFrame(:final transfer):
        transfers.upsert(transfer);
      case WsEventFrame(:final event):
        events.append(event);
        if (event.type == 'CONFLICT_DETECTED' ||
            event.type == 'CONFLICT_RESOLVED') {
          conflicts.refresh();
        }
      case WsPong():
        break;
      case WsUnknown():
        break; // Forward compatibility: unknown frames are ignored.
    }
  }

  /// Full REST refetch after a (re)connection.
  void _refetchAll() {
    peers.refresh();
    folders.refresh();
    transfers.refresh();
    conflicts.refresh();
    events.refresh();
    connection.refreshDevice();
  }

  void _teardownWs() {
    _frameSub?.cancel();
    _frameSub = null;
    _reconnectSub?.cancel();
    _reconnectSub = null;
    final ws = _ws;
    _ws = null;
    if (ws != null) {
      // stop() closes the streams; a live-service teardown must not await
      // socket close — fire and forget is fine here.
      unawaited(ws.stop());
    }
  }

  void dispose() {
    _teardownWs();
    connection.removeListener(_onConnectionChanged);
    _started = false;
  }
}
