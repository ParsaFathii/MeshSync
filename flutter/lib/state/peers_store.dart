/// Peer list state: REST refresh + WS `peers` frames + pair/approve/revoke.
///
/// Screens own their polling timers and call [refresh]; this store only
/// holds state and performs actions.
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class PeersStore extends ChangeNotifier {
  PeersStore({required AgentApi Function() api})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;

  List<Peer> peers = const <Peer>[];
  LoadState state = LoadState.idle;
  String? error;
  bool _busy = false;

  AgentApi get _currentApi {
    final next = _apiProvider();
    if (!identical(next, _api)) {
      _api = next;
    }
    return _api;
  }

  List<Peer> get trustedPeers =>
      peers.where((p) => p.trust == TrustLevel.trusted).toList();

  List<Peer> get pendingPeers =>
      peers.where((p) => p.trust == TrustLevel.pairing).toList();

  Future<void> refresh() async {
    if (_busy) return;
    _busy = true;
    if (state != LoadState.loaded) {
      state = LoadState.loading;
      notifyListeners();
    }
    try {
      peers = await _currentApi.getPeers();
      state = LoadState.loaded;
      error = null;
      notifyListeners();
    } catch (err) {
      state = LoadState.error;
      error = describeAgentError(err);
      notifyListeners();
    } finally {
      _busy = false;
    }
  }

  /// Replaces the whole list from a WS `peers` frame.
  void applyPeers(List<Peer> framePeers) {
    peers = framePeers;
    if (state != LoadState.loaded) {
      state = LoadState.loaded;
      error = null;
    }
    notifyListeners();
  }

  Future<Peer> pair(String address) async {
    final peer = await _currentApi.pairPeer(address);
    await _replaceOrAdd(peer);
    return peer;
  }

  Future<Peer> approve(String peerId) async {
    final peer = await _currentApi.approvePeer(peerId);
    await _replaceOrAdd(peer);
    return peer;
  }

  Future<Peer> revoke(String peerId) async {
    final peer = await _currentApi.revokePeer(peerId);
    await _replaceOrAdd(peer);
    return peer;
  }

  Future<void> remove(String peerId) async {
    await _currentApi.removePeer(peerId);
    peers = peers.where((p) => p.peerId != peerId).toList();
    notifyListeners();
  }

  /// One discovery sweep; returns newly discovered peers for feedback.
  Future<List<DiscoveredPeer>> scan() async {
    final found = await _currentApi.scanDiscovery();
    await refresh();
    return found;
  }

  Future<void> _replaceOrAdd(Peer peer) async {
    final idx = peers.indexWhere((p) => p.peerId == peer.peerId);
    if (idx >= 0) {
      peers = List<Peer>.of(peers)..[idx] = peer;
    } else {
      peers = List<Peer>.of(peers)..add(peer);
    }
    notifyListeners();
  }
}
