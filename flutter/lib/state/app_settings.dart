/// App-level settings persisted as a small JSON file (no plugins needed).
///
/// Persists: agent host + API port, language (fa/en), theme mode. The file
/// lives under the platform's user-data directory when discoverable via
/// environment variables (`XDG_DATA_HOME`, `HOME`, `APPDATA`); otherwise it
/// falls back to the system temp directory (non-persistent — documented
/// limitation of a dart:io-only approach on some platforms).
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../l10n/strings.dart';

class AppSettings extends ChangeNotifier {
  AppSettings({
    this.host = defaultHost,
    this.apiPort = defaultApiPort,
    this.language = defaultLanguage,
    this.themeMode = defaultThemeMode,
    File? storage,
  }) : _storageOverride = storage;

  static const String defaultHost = '127.0.0.1';
  static const int defaultApiPort = 3040;
  static const String defaultLanguage = 'fa';
  static const String defaultThemeMode = 'system';

  static const List<String> languages = ['fa', 'en'];
  static const List<String> themeModes = ['system', 'light', 'dark'];

  final File? _storageOverride;

  String host;
  int apiPort;
  String language;
  String themeMode;

  bool get isRtl => language == 'fa';

  AppStrings get strings => language == 'fa' ? AppStrings.fa : AppStrings.en;

  /// Loads persisted values; falls back to defaults on any error.
  Future<void> load() async {
    try {
      final file = _storageOverride ?? await _resolveStorage();
      if (!await file.exists()) return;
      final raw = await file.readAsString();
      if (raw.trim().isEmpty) return;
      final parsed = jsonDecode(raw);
      if (parsed is! Map<String, dynamic>) return;
      host = _readString(parsed, 'host', host);
      apiPort = _readInt(parsed, 'apiPort', apiPort);
      language = _readString(parsed, 'language', language);
      themeMode = _readString(parsed, 'themeMode', themeMode);
      notifyListeners();
    } catch (_) {
      // Corrupt or unreadable settings must never crash the app.
    }
  }

  Future<void> save() async {
    try {
      final file = _storageOverride ?? await _resolveStorage();
      await file.parent.create(recursive: true);
      await file.writeAsString(const JsonEncoder.withIndent('  ').convert({
        'host': host,
        'apiPort': apiPort,
        'language': language,
        'themeMode': themeMode,
      }));
    } catch (_) {
      // Persistence failures are non-fatal for this session.
    }
  }

  void updateConnection({required String host, required int apiPort}) {
    this.host = host;
    this.apiPort = apiPort;
    notifyListeners();
    save();
  }

  void setLanguage(String language) {
    if (!languages.contains(language)) return;
    this.language = language;
    notifyListeners();
    save();
  }

  void setThemeMode(String themeMode) {
    if (!themeModes.contains(themeMode)) return;
    this.themeMode = themeMode;
    notifyListeners();
    save();
  }

  static String _readString(Map<String, dynamic> map, String key, String fallback) {
    final v = map[key];
    return v is String && v.isNotEmpty ? v : fallback;
  }

  static int _readInt(Map<String, dynamic> map, String key, int fallback) {
    final v = map[key];
    if (v is int) return v;
    if (v is num) return v.toInt();
    if (v is String) {
      final parsed = int.tryParse(v);
      if (parsed != null) return parsed;
    }
    return fallback;
  }

  Future<File> _resolveStorage() async {
    final dir = _appSupportDir();
    if (dir != null) {
      return File(
        '${dir.path}${Platform.pathSeparator}meshsync'
        '${Platform.pathSeparator}settings.json',
      );
    }
    return File(
      '${Directory.systemTemp.path}${Platform.pathSeparator}meshsync-settings.json',
    );
  }

  static Directory? _appSupportDir() {
    final env = Platform.environment;
    final xdg = env['XDG_DATA_HOME'];
    if (xdg != null && xdg.isNotEmpty) return Directory(xdg);
    if (env.containsKey('APPDATA')) {
      final appData = env['APPDATA'];
      if (appData != null && appData.isNotEmpty) return Directory(appData);
    }
    final home = env['HOME'];
    if (home != null && home.isNotEmpty) {
      if (Platform.isWindows) return Directory(home);
      return Directory('$home${Platform.pathSeparator}.local${Platform.pathSeparator}share');
    }
    return null;
  }
}
