/// HTTP client for the MeshSync agent API v1 (docs/API.md).
///
/// Design rules:
/// * Talks DIRECTLY to the agent at `http://{host}:{port}` (no gateway). If
///   [viaGateway] is set, every request — including the WebSocket URL — also
///   carries `XTransformPort={port}` as a query parameter for deployments
///   that front agents with the routing gateway.
/// * Every non-2xx response uses the agent error envelope
///   `{"error":{"code","message"}}` → [AgentApiException].
/// * Network-level failures (refused, reset, timeout, non-JSON garbage) →
///   [AgentUnreachableException]. GET requests are retried once.
/// * 15 s default timeout, no exceptions swallowed, no logging of secrets:
///   a bearer token (if any) is kept in memory only and never printed.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../models/models.dart';

/// Typed error carrying the agent error envelope code + message.
class AgentApiException implements Exception {
  const AgentApiException({
    required this.code,
    required this.message,
    required this.statusCode,
  });

  final String code;
  final String message;
  final int statusCode;

  @override
  String toString() => 'AgentApiException($statusCode $code): $message';
}

/// The agent could not be reached at all (offline, refused, timeout).
class AgentUnreachableException implements Exception {
  const AgentUnreachableException(this.host, this.port, [this.detail]);

  final String host;
  final int port;
  final String? detail;

  bool get isTimeout => detail == 'request timed out';

  @override
  String toString() =>
      'AgentUnreachableException($host:$port${detail == null ? '' : ': $detail'})';
}

/// A thrown [AgentApiException] that a screen wants to display as text.
String describeAgentError(Object error) {
  if (error is AgentApiException) {
    return '${error.code}: ${error.message}';
  }
  if (error is AgentUnreachableException) {
    return '${error.host}:${error.port} ${error.detail ?? 'unreachable'}';
  }
  return error.toString();
}

/// Full REST + WS client for one agent.
class AgentApi {
  AgentApi({
    required this.host,
    required this.port,
    this.viaGateway = false,
    this.token,
    http.Client? client,
    this.timeout = const Duration(seconds: 15),
  })  : _client = client ?? http.Client();

  /// Host the agent is reachable at (IP or DNS name).
  final String host;

  /// Agent API port (3040 / 3041 in the reference deployment).
  final int port;

  /// When true, `XTransformPort={port}` is appended to every URL for
  /// gateway-fronted deployments. Direct LAN usage keeps this false.
  final bool viaGateway;

  /// Optional bearer token for agents configured with `--api-token`.
  /// In-memory only, never persisted, never logged.
  final String? token;

  /// Default request timeout.
  final Duration timeout;

  final http.Client _client;

  String get baseUrl => 'http://$host:$port';

  String get httpAuthority => '$host:$port';

  /// URL of the WebSocket event stream (GET /api/v1/events/ws).
  String webSocketUrl() {
    final base = 'ws://$host:$port/api/v1/events/ws';
    if (!viaGateway) return base;
    return '$base?XTransformPort=$port';
  }

  Map<String, String> _headers({bool json = false}) {
    final h = <String, String>{};
    if (json) h['Content-Type'] = 'application/json';
    if (token != null && token!.isNotEmpty) {
      h['Authorization'] = 'Bearer $token';
    }
    return h;
  }

  String _url(String path, [Map<String, String>? query]) {
    var p = path.startsWith('/') ? path : '/$path';
    final q = Map<String, String>.of(query ?? const <String, String>{});
    if (viaGateway) q['XTransformPort'] = '$port';
    if (q.isNotEmpty) {
      final sep = p.contains('?') ? '&' : '?';
      p = '$p$sep${q.entries.map((e) => '${e.key}=${e.value}').join('&')}';
    }
    return '$baseUrl$p';
  }

  // -------------------------------------------------------------------------
  // Core request pipeline
  // -------------------------------------------------------------------------

  /// Executes one request; retries GETs once on network-level failure.
  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    Duration? timeout,
    bool retry = true,
  }) async {
    final url = _url(path, query);
    final encodedBody = body == null ? null : jsonEncode(body);
    Future<http.Response> attempt() => _client
        .send(http.Request(method, Uri.parse(url))
          ..headers.addAll(_headers(json: encodedBody != null))
          ..bodyBytes = utf8.encode(encodedBody ?? ''))
        .then(http.Response.fromStream)
        .timeout(timeout ?? this.timeout);

    http.Response? response;
    try {
      response = await attempt();
    } catch (firstError) {
      if (!retry || method != 'GET') {
        throw _asUnreachable(firstError);
      }
      // One retry for read-only requests.
      try {
        response = await attempt();
      } catch (secondError) {
        throw _asUnreachable(secondError);
      }
    }

    if (response.statusCode == 204) return null;

    final text = response.body;
    dynamic parsed;
    if (text.isNotEmpty) {
      try {
        parsed = jsonDecode(text);
      } catch (_) {
        parsed = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return parsed;
    }

    // Typed error envelope from the agent itself.
    final envelope = parsed is Map<String, dynamic> ? parsed['error'] : null;
    if (envelope is Map<String, dynamic>) {
      final code = envelope['code'];
      final message = envelope['message'];
      throw AgentApiException(
        code: code is String ? code : 'UNKNOWN',
        message: message is String ? message : 'unknown agent error',
        statusCode: response.statusCode,
      );
    }

    throw AgentUnreachableException(host, port, 'HTTP ${response.statusCode}');
  }

  AgentUnreachableException _asUnreachable(Object error) {
    if (error is TimeoutException) {
      return AgentUnreachableException(host, port, 'request timed out');
    }
    var detail = 'network error';
    if (error is http.ClientException) {
      detail = error.message;
    } else if (error is SocketException) {
      detail = error.message;
    } else if (error is HttpException) {
      detail = error.message;
    }
    return AgentUnreachableException(host, port, detail);
  }

  static Map<String, String> _queryOf({
    int? folder,
    String? path,
    String? peer,
    int? limit,
    String? status,
    int? sinceEventId,
  }) {
    final q = <String, String>{};
    if (folder != null) q['folder'] = '$folder';
    if (path != null && path.isNotEmpty) q['path'] = Uri.encodeQueryComponent(path);
    if (peer != null && peer.isNotEmpty) q['peer'] = Uri.encodeQueryComponent(peer);
    if (limit != null) q['limit'] = '$limit';
    if (status != null && status.isNotEmpty) q['status'] = status;
    if (sinceEventId != null) q['sinceEventId'] = '$sinceEventId';
    return q;
  }

  // -------------------------------------------------------------------------
  // Health & device
  // -------------------------------------------------------------------------

  Future<Health> getHealth({Duration? timeout}) async =>
      Health.fromJson(await _send('GET', '/api/v1/health', timeout: timeout));

  Future<DeviceInfo> getDevice() async =>
      DeviceInfo.fromJson(await _send('GET', '/api/v1/device'));

  // -------------------------------------------------------------------------
  // Peers & discovery
  // -------------------------------------------------------------------------

  Future<List<Peer>> getPeers() async {
    final raw = await _send('GET', '/api/v1/peers');
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['peers'];
    return list is List ? list.map(Peer.fromJson).toList() : <Peer>[];
  }

  Future<Peer> pairPeer(String address) async {
    final raw = await _send('POST', '/api/v1/peers/pair', body: {
      'address': address,
    });
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Peer.fromJson(map['peer']);
  }

  Future<Peer> approvePeer(String peerId) async {
    final raw = await _send(
      'POST',
      '/api/v1/peers/${Uri.encodeComponent(peerId)}/approve',
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Peer.fromJson(map['peer']);
  }

  Future<Peer> revokePeer(String peerId) async {
    final raw = await _send(
      'POST',
      '/api/v1/peers/${Uri.encodeComponent(peerId)}/revoke',
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Peer.fromJson(map['peer']);
  }

  /// Removes the peer record entirely. 204 → true.
  Future<void> removePeer(String peerId) async {
    await _send('DELETE', '/api/v1/peers/${Uri.encodeComponent(peerId)}');
  }

  Future<List<DiscoveredPeer>> scanDiscovery() async {
    final raw = await _send('POST', '/api/v1/discovery/scan');
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['found'];
    return list is List
        ? list.map(DiscoveredPeer.fromJson).toList()
        : <DiscoveredPeer>[];
  }

  // -------------------------------------------------------------------------
  // Shared folders
  // -------------------------------------------------------------------------

  Future<List<SharedFolder>> getFolders() async {
    final raw = await _send('GET', '/api/v1/shared-folders');
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['folders'];
    return list is List ? list.map(SharedFolder.fromJson).toList() : <SharedFolder>[];
  }

  Future<SharedFolder> addFolder({required String name, required String path}) async {
    final raw = await _send('POST', '/api/v1/shared-folders', body: {
      'name': name,
      'path': path,
    });
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return SharedFolder.fromJson(map['folder']);
  }

  Future<void> removeFolder(int folderId, {bool deleteFiles = false}) async {
    await _send(
      'DELETE',
      '/api/v1/shared-folders/$folderId',
      body: {'deleteFiles': deleteFiles},
    );
  }

  Future<RescanResult> rescanFolder(int folderId) async =>
      RescanResult.fromJson(
        await _send('POST', '/api/v1/shared-folders/$folderId/rescan'),
      );

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  Future<FilesListing> listFiles({required int folderId, String path = ''}) async =>
      FilesListing.fromJson(await _send(
        'GET',
        '/api/v1/files',
        query: _queryOf(folder: folderId, path: path),
      ));

  Future<FileDetail> fileDetail({required int folderId, required String path}) async =>
      FileDetail.fromJson(await _send(
        'GET',
        '/api/v1/files/detail',
        query: _queryOf(folder: folderId, path: path),
      ));

  /// Streams the file content via GET /api/v1/files/content and returns the
  /// raw bytes (files are indexed and hashed — content is real, never mocked).
  Future<List<int>> downloadFile({
    required int folderId,
    required String path,
    Duration? timeout,
  }) async {
    final url = _url(
      '/api/v1/files/content',
      _queryOf(folder: folderId, path: path),
    );
    try {
      final response = await _client
          .send(http.Request('GET', Uri.parse(url))
            ..headers.addAll(_headers()))
          .then(http.Response.fromStream)
          .timeout(timeout ?? this.timeout);
      if (response.statusCode == 200) return response.bodyBytes;
      final parsed = _tryDecode(response.body);
      final envelope = parsed is Map<String, dynamic> ? parsed['error'] : null;
      if (envelope is Map<String, dynamic> && envelope['code'] is String) {
        throw AgentApiException(
          code: envelope['code'] as String,
          message: envelope['message'] is String
              ? envelope['message'] as String
              : 'unknown agent error',
          statusCode: response.statusCode,
        );
      }
      throw AgentUnreachableException(host, port, 'HTTP ${response.statusCode}');
    } catch (error) {
      if (error is AgentApiException || error is AgentUnreachableException) rethrow;
      throw _asUnreachable(error);
    }
  }

  static dynamic _tryDecode(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  /// Creates or replaces a UTF-8 text file, then indexes it.
  Future<FileDetail> createTextFile({
    required int folderId,
    required String path,
    required String content,
  }) async =>
      FileDetail.fromJson(await _send('POST', '/api/v1/files', body: {
        'folder': folderId,
        'path': path,
        'content': content,
        'encoding': 'utf8',
      }));

  /// Moves the file to the agent trash and tombstones it. 204 → true.
  Future<void> deleteFile({required int folderId, required String path}) async {
    await _send(
      'DELETE',
      '/api/v1/files',
      query: _queryOf(folder: folderId, path: path),
    );
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  Future<SyncPlan> syncPlan({required String peerId, required int folderId}) async =>
      SyncPlan.fromJson(await _send(
        'GET',
        '/api/v1/sync/plan',
        query: _queryOf(peer: peerId, folder: folderId),
      ));

  Future<SyncRunResult> syncRun({required String peerId, required int folderId}) async =>
      SyncRunResult.fromJson(await _send('POST', '/api/v1/sync/run', body: {
        'peer': peerId,
        'folder': folderId,
      }));

  Future<List<SyncSession>> getSessions() async {
    final raw = await _send('GET', '/api/v1/sync/sessions');
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['sessions'];
    return list is List ? list.map(SyncSession.fromJson).toList() : <SyncSession>[];
  }

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------

  Future<List<Transfer>> getTransfers({int? limit, String? status}) async {
    final raw = await _send(
      'GET',
      '/api/v1/transfers',
      query: _queryOf(limit: limit, status: status),
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['transfers'];
    return list is List ? list.map(Transfer.fromJson).toList() : <Transfer>[];
  }

  Future<TransferDetail> getTransfer(String transferId) async =>
      TransferDetail.fromJson(
        await _send('GET', '/api/v1/transfers/${Uri.encodeComponent(transferId)}'),
      );

  Future<Transfer> transferAction(String transferId, TransferAction action) async {
    final raw = await _send(
      'POST',
      '/api/v1/transfers/${Uri.encodeComponent(transferId)}/${action.pathSegment}',
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Transfer.fromJson(map['transfer']);
  }

  // -------------------------------------------------------------------------
  // Conflicts
  // -------------------------------------------------------------------------

  Future<List<Conflict>> getConflicts() async {
    final raw = await _send('GET', '/api/v1/conflicts');
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['conflicts'];
    return list is List ? list.map(Conflict.fromJson).toList() : <Conflict>[];
  }

  Future<Conflict> resolveConflict({
    required int conflictId,
    required ConflictResolution action,
  }) async {
    final raw = await _send(
      'POST',
      '/api/v1/conflicts/$conflictId/resolve',
      body: {'action': action.wireName},
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return Conflict.fromJson(map['conflict']);
  }

  // -------------------------------------------------------------------------
  // Events (REST polling) — the WS stream lives in WsClient.
  // -------------------------------------------------------------------------

  Future<List<AgentEvent>> getEvents({int? sinceEventId, int? limit}) async {
    final raw = await _send(
      'GET',
      '/api/v1/events',
      query: _queryOf(sinceEventId: sinceEventId, limit: limit),
    );
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final list = map['events'];
    return list is List ? list.map(AgentEvent.fromJson).toList() : <AgentEvent>[];
  }

  // -------------------------------------------------------------------------
  // Agent settings
  // -------------------------------------------------------------------------

  Future<AgentSettings> getSettings() async =>
      AgentSettings.fromJson(await _send('GET', '/api/v1/settings'));

  Future<AgentSettings> putSettings(AgentSettings settings) async =>
      AgentSettings.fromJson(
        await _send('PUT', '/api/v1/settings', body: settings.toJson()),
      );

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /// Closes the underlying HTTP client (does not affect open WebSockets).
  void close() => _client.close();
}
