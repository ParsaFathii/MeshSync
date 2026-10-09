/// Shared folder list state + add / remove / rescan actions.
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class FoldersStore extends ChangeNotifier {
  FoldersStore({required AgentApi Function() api})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;

  List<SharedFolder> folders = const <SharedFolder>[];
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

  Future<void> refresh() async {
    if (_busy) return;
    _busy = true;
    if (state != LoadState.loaded) {
      state = LoadState.loading;
      notifyListeners();
    }
    try {
      folders = await _currentApi.getFolders();
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

  /// Adds a shared folder; the caller surfaces typed errors (VALIDATION,
  /// IO_ERROR …) as snackbars.
  Future<SharedFolder> add({required String name, required String path}) async {
    final folder = await _currentApi.addFolder(name: name, path: path);
    final idx = folders.indexWhere((f) => f.id == folder.id);
    if (idx >= 0) {
      folders = List<SharedFolder>.of(folders)..[idx] = folder;
    } else {
      folders = List<SharedFolder>.of(folders)..add(folder);
    }
    state = LoadState.loaded;
    notifyListeners();
    return folder;
  }

  Future<void> remove(int folderId, {bool deleteFiles = false}) async {
    await _currentApi.removeFolder(folderId, deleteFiles: deleteFiles);
    folders = folders.where((f) => f.id != folderId).toList();
    notifyListeners();
  }

  Future<RescanResult> rescan(int folderId) async {
    final result = await _currentApi.rescanFolder(folderId);
    final idx = folders.indexWhere((f) => f.id == folderId);
    if (idx >= 0) {
      folders = List<SharedFolder>.of(folders)..[idx] = result.folder;
      notifyListeners();
    }
    return result;
  }
}
