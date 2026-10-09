/// Directory browsing state for one shared folder (`GET /api/v1/files`).
///
/// The store tracks the current relative [path] inside [folder]; navigation
/// is forward-only plus a [goUp] helper — screens drive back-stack via the
/// platform navigator.
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class FilesStore extends ChangeNotifier {
  FilesStore({required AgentApi Function() api})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;

  SharedFolder? folder;
  String path = '';
  FilesListing? listing;
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

  bool get hasFolder => folder != null;

  String fullPathFor(String name) =>
      path.isEmpty ? name : '$path/$name';

  Future<void> openFolder(SharedFolder target) async {
    folder = target;
    path = '';
    listing = null;
    return refresh();
  }

  Future<void> navigate(String subDir) {
    path = path.isEmpty ? subDir : '$path/$subDir';
    return refresh();
  }

  Future<void> goUp() {
    if (path.isEmpty) {
      return Future.value();
    }
    final idx = path.lastIndexOf('/');
    path = idx <= 0 ? '' : path.substring(0, idx);
    return refresh();
  }

  Future<void> refresh() async {
    final currentFolder = folder;
    if (currentFolder == null) return;
    if (_busy) return;
    _busy = true;
    state = LoadState.loading;
    notifyListeners();
    try {
      listing = await _currentApi.listFiles(
        folderId: currentFolder.id,
        path: path,
      );
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

  Future<FileDetail> fetchFileDetail(FileEntry entry) {
    final currentFolder = folder;
    if (currentFolder == null) {
      throw StateError('no folder open');
    }
    return _currentApi.fileDetail(
      folderId: currentFolder.id,
      path: fullPathFor(entry.name),
    );
  }

  Future<FileDetail> createTextFile(String name, String content) async {
    final currentFolder = folder;
    if (currentFolder == null) {
      throw StateError('no folder open');
    }
    final detail = await _currentApi.createTextFile(
      folderId: currentFolder.id,
      path: fullPathFor(name),
      content: content,
    );
    await refresh();
    return detail;
  }

  Future<void> deleteFile(FileEntry entry) async {
    final currentFolder = folder;
    if (currentFolder == null) {
      throw StateError('no folder open');
    }
    await _currentApi.deleteFile(
      folderId: currentFolder.id,
      path: fullPathFor(entry.name),
    );
    await refresh();
  }

  /// Downloads real file content through `GET /api/v1/files/content`.
  Future<List<int>> downloadFile(FileEntry entry) async {
    final currentFolder = folder;
    if (currentFolder == null) {
      throw StateError('no folder open');
    }
    return _currentApi.downloadFile(
      folderId: currentFolder.id,
      path: fullPathFor(entry.name),
    );
  }
}
