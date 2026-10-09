/// Owns the live [AgentApi] instance and the agent connection state.
///
/// Polls `/api/v1/health` every 5 s, fetches `/api/v1/device` once healthy,
/// and rebuilds the API client whenever the agent address changes in
/// [AppSettings]. Data stores read `connection.api` lazily so they always
/// talk to the current agent.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'app_settings.dart';

class ConnectionStore extends ChangeNotifier {
  ConnectionStore({
    required AppSettings settings,
    AgentApi? initialApi,
    this.healthInterval = const Duration(seconds: 5),
  }) : _settings = settings {
    _api = initialApi ?? AgentApi(host: settings.host, port: settings.apiPort);
    settings.addListener(_onSettingsChanged);
  }

  final AppSettings _settings;

  /// Health polling cadence used by [start].
  final Duration healthInterval;

  late AgentApi _api;
  Timer? _timer;
  bool _started = false;

  /// Increments every time the API client is rebuilt (address change) —
  /// the live service watches this to reconnect its WebSocket.
  int apiEpoch = 0;

  bool online = false;
  bool connecting = false;
  Health? health;
  DeviceInfo? deviceInfo;
  String? lastError;

  AgentApi get api => _api;
  AppSettings get settings => _settings;

  String get agentAddress => '${settings.host}:${settings.apiPort}';

  /// Starts the health polling loop.
  void start() {
    if (_started) return;
    _started = true;
    _timer = Timer.periodic(healthInterval, (_) => checkNow());
    checkNow();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _settings.removeListener(_onSettingsChanged);
    _api.close();
    super.dispose();
  }

  /// Immediate health check + device fetch. Errors are swallowed into
  /// [lastError] — the UI renders the offline state from them.
  Future<void> checkNow() async {
    connecting = true;
    notifyListeners();
    try {
      health = await _api.getHealth(
        timeout: const Duration(seconds: 4),
      );
      online = true;
      connecting = false;
      lastError = null;
      notifyListeners();
      if (deviceInfo == null) {
        await refreshDevice();
      }
    } on AgentUnreachableException catch (error) {
      online = false;
      connecting = false;
      lastError = error.detail ?? 'unreachable';
      notifyListeners();
    } catch (_) {
      online = false;
      connecting = false;
      lastError = 'unexpected agent response';
      notifyListeners();
    }
  }

  /// Re-fetches `/api/v1/device` (stats refresh, WS `device` frames land
  /// here too via [applyDeviceInfo]).
  Future<void> refreshDevice() async {
    try {
      deviceInfo = await _api.getDevice();
      notifyListeners();
    } catch (_) {
      // Health already governs the offline banner.
    }
  }

  /// Applies a `device`/`hello` frame payload from the WebSocket.
  void applyDeviceInfo(DeviceInfo info) {
    deviceInfo = info;
    online = true;
    notifyListeners();
  }

  void _onSettingsChanged() {
    if (_api.host == _settings.host && _api.port == _settings.apiPort) {
      return;
    }
    final oldApi = _api;
    _api = AgentApi(host: _settings.host, port: _settings.apiPort);
    oldApi.close();
    apiEpoch++;
    health = null;
    deviceInfo = null;
    online = false;
    notifyListeners();
    checkNow();
  }
}
