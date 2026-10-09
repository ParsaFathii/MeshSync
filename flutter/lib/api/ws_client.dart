/// WebSocket client for the agent event stream (GET /api/v1/events/ws).
///
/// Protocol (docs/API.md): server pushes one JSON object per frame with
/// `kind` = hello | event | transfer | peers | device | pong. The client
/// sends `{"kind":"ping"}` heartbeats. Disconnects are expected; this client
/// reconnects with capped exponential backoff and reports reconnections so
/// the stores can refetch state over REST (stale WS state is never trusted).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/models.dart';

enum WsConnectionState { disconnected, connecting, connected }

class WsClient {
  WsClient({
    required this.url,
    this.token,
    this.pingInterval = const Duration(seconds: 20),
    this.backoffCap = const Duration(seconds: 30),
    Duration? connectTimeout,
  }) : _connectTimeout = connectTimeout ?? const Duration(seconds: 8);

  /// ws:// URL — usually built from [AgentApi.webSocketUrl].
  final String url;

  /// Optional bearer token (in-memory only, never logged).
  final String? token;
  final Duration pingInterval;
  final Duration backoffCap;
  final Duration _connectTimeout;

  final _frames = StreamController<WsFrame>.broadcast();
  final _connectionStates = StreamController<WsConnectionState>.broadcast();
  final _reconnected = StreamController<void>.broadcast();

  /// Parsed server frames (never closes while the client runs).
  Stream<WsFrame> get frames => _frames.stream;

  /// Connection lifecycle transitions.
  Stream<WsConnectionState> get connectionStates => _connectionStates.stream;

  /// Fires after every successful (re)connection — stores use it to refetch.
  Stream<void> get reconnected => _reconnected.stream;

  WebSocket? _socket;
  Timer? _pingTimer;
  Timer? _reconnectTimer;
  StreamSubscription? _socketSub;
  bool _running = false;
  bool _everConnected = false;
  int _attempt = 0;

  WsConnectionState state = WsConnectionState.disconnected;

  /// Starts connecting. Safe to call multiple times; no-op while running.
  void start() {
    if (_running) return;
    _running = true;
    _connect();
  }

  Future<void> _connect() async {
    if (!_running) return;
    _setState(WsConnectionState.connecting);
    try {
      final socket = await WebSocket.connect(
        url,
        headers: _headers(),
      ).timeout(_connectTimeout);
      _socket = socket;
      _attempt = 0;
      _setState(WsConnectionState.connected);
      if (_everConnected) {
        _reconnected.add(null);
      }
      _everConnected = true;
      _startPing();
      _socketSub = socket.listen(
        _onData,
        onDone: _onDisconnected,
        onError: (_) => _onDisconnected(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  Map<String, String> _headers() {
    if (token == null || token!.isEmpty) return const <String, String>{};
    return {'Authorization': 'Bearer $token'};
  }

  void _onData(dynamic data) {
    if (data is! String) return;
    dynamic decoded;
    try {
      decoded = jsonDecode(data);
    } catch (_) {
      return; // Ignore malformed frames; REST remains the source of truth.
    }
    _frames.add(WsFrame.fromJson(decoded));
  }

  void _startPing() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(pingInterval, (_) => sendPing());
    sendPing();
  }

  /// Sends the protocol heartbeat `{"kind":"ping"}`.
  void sendPing() {
    final socket = _socket;
    if (socket == null || socket.readyState != WebSocket.open) return;
    try {
      socket.add(jsonEncode({'kind': 'ping'}));
    } catch (_) {
      // The onDone/error path handles the disconnect.
    }
  }

  void _onDisconnected() {
    _cleanupSocket();
    if (_running) {
      _scheduleReconnect();
    } else {
      _setState(WsConnectionState.disconnected);
    }
  }

  void _scheduleReconnect() {
    if (!_running) return;
    _setState(WsConnectionState.disconnected);
    final delay = Duration(
      milliseconds: _backoffMs(),
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, _connect);
  }

  int _backoffMs() {
    final step = 500 * (1 << _attempt.clamp(0, 6)); // 0.5s, 1s, 2s … 32s
    _attempt++;
    return step.clamp(500, backoffCap.inMilliseconds);
  }

  void _setState(WsConnectionState next) {
    if (state == next) return;
    state = next;
    _connectionStates.add(next);
  }

  void _cleanupSocket() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _socketSub?.cancel();
    _socketSub = null;
    _socket?.close();
    _socket = null;
  }

  /// Stops the client and closes streams. Cannot be restarted afterwards.
  Future<void> stop() async {
    _running = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _cleanupSocket();
    _setState(WsConnectionState.disconnected);
    await _frames.close();
    await _connectionStates.close();
    await _reconnected.close();
  }
}
