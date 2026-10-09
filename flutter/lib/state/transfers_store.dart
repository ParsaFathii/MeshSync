/// Live transfer list: REST polling (screens drive 2 s refresh) + WS
/// `transfer` frames + pause/resume/cancel/retry actions.
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class TransfersStore extends ChangeNotifier {
  TransfersStore({required AgentApi Function() api})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;

  List<Transfer> transfers = const <Transfer>[];
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

  List<Transfer> get activeTransfers =>
      transfers.where((t) => t.status.isActive).toList();

  Future<void> refresh() async {
    if (_busy) return;
    _busy = true;
    if (state != LoadState.loaded) {
      state = LoadState.loading;
      notifyListeners();
    }
    try {
      transfers = await _currentApi.getTransfers(limit: 100);
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

  /// Applies a WS `transfer` frame (progress ticks, state changes).
  void upsert(Transfer transfer) {
    final idx = transfers.indexWhere((t) => t.id == transfer.id);
    if (idx >= 0) {
      transfers = List<Transfer>.of(transfers)..[idx] = transfer;
    } else {
      transfers = List<Transfer>.of(transfers)..insert(0, transfer);
    }
    if (state != LoadState.loaded) {
      state = LoadState.loaded;
      error = null;
    }
    notifyListeners();
  }

  Future<Transfer> pause(String transferId) =>
      _action(transferId, TransferAction.pause);

  Future<Transfer> resume(String transferId) =>
      _action(transferId, TransferAction.resume);

  Future<Transfer> cancel(String transferId) =>
      _action(transferId, TransferAction.cancel);

  Future<Transfer> retry(String transferId) =>
      _action(transferId, TransferAction.retry);

  Future<Transfer> _action(String transferId, TransferAction action) async {
    final transfer = await _currentApi.transferAction(transferId, action);
    upsert(transfer);
    return transfer;
  }
}
