/// Conflict list state + KEEP_LOCAL / KEEP_REMOTE / KEEP_BOTH / LATER.
///
/// Screens own their polling timers and call [refresh].
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class ConflictsStore extends ChangeNotifier {
  ConflictsStore({required AgentApi Function() api})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;

  List<Conflict> conflicts = const <Conflict>[];
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

  List<Conflict> get openConflicts =>
      conflicts.where((c) => c.status == ConflictStatus.open).toList();

  List<Conflict> get resolvedConflicts =>
      conflicts.where((c) => c.status == ConflictStatus.resolved).toList();

  Future<void> refresh() async {
    if (_busy) return;
    _busy = true;
    if (state != LoadState.loaded) {
      state = LoadState.loading;
      notifyListeners();
    }
    try {
      conflicts = await _currentApi.getConflicts();
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

  /// Resolves one conflict; on failure (e.g. PEER_OFFLINE) the typed error
  /// propagates so the screen can keep the conflict open and inform the user.
  Future<Conflict> resolve(int conflictId, ConflictResolution action) async {
    final conflict = await _currentApi.resolveConflict(
      conflictId: conflictId,
      action: action,
    );
    final idx = conflicts.indexWhere((c) => c.id == conflict.id);
    if (idx >= 0) {
      conflicts = List<Conflict>.of(conflicts)..[idx] = conflict;
    } else {
      conflicts = List<Conflict>.of(conflicts)..add(conflict);
    }
    notifyListeners();
    return conflict;
  }
}
