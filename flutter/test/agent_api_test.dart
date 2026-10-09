/// AgentApi client tests against a real in-process HTTP server
/// (dart:io HttpServer on an ephemeral port — no mocking library needed).
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:meshsync/api/agent_api.dart';
import 'package:meshsync/models/models.dart';

void main() {
  late HttpServer server;
  late List<RecordedRequest> recorded;
  String? respondWithJson;
  int respondStatus = 200;

  setUp(() async {
    recorded = [];
    respondWithJson = null;
    respondStatus = 200;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      final body = await utf8.decoder
          .bind(req)
          .fold<String>('', (prev, chunk) => prev + chunk);
      recorded.add(RecordedRequest(
        method: req.method,
        uri: req.uri,
        contentType: req.headers.value('content-type'),
        authorization: req.headers.value('authorization'),
        body: body,
      ));
      final res = req.response;
      res.statusCode = respondStatus;
      final json = respondWithJson;
      if (json != null) {
        res.headers.contentType = ContentType.json;
        res.write(json);
      }
      await res.close();
    });
  });

  tearDown(() async {
    await server.close(force: true);
  });

  AgentApi apiFor({bool viaGateway = false, String? token}) => AgentApi(
        host: '127.0.0.1',
        port: server.port,
        viaGateway: viaGateway,
        token: token,
        timeout: const Duration(seconds: 2),
      );

  group('AgentApi over a real local HTTP server', () {
    test('GET /api/v1/health hits the right path and parses Health',
        () async {
      respondWithJson =
          '{"status":"ok","version":"0.1.0","uptimeSeconds":5,"dbOk":true}';
      final health = await apiFor().getHealth();
      expect(recorded.single.method, 'GET');
      expect(recorded.single.uri.path, '/api/v1/health');
      expect(health.status, 'ok');
      expect(health.dbOk, isTrue);
    });

    test('POST /api/v1/peers/pair sends a JSON body and comes back typed',
        () async {
      respondWithJson =
          '{"peer":{"peerId":"ec36","name":"mesh-beta","trust":"PAIRING",'
          '"online":false,"version":"0.1.0","sharedFolders":0}}';
      final peer = await apiFor().pairPeer('127.0.0.1:4041');
      final rec = recorded.single;
      expect(rec.method, 'POST');
      expect(rec.uri.path, '/api/v1/peers/pair');
      expect(rec.contentType, contains('application/json'));
      expect(jsonDecode(rec.body!), {'address': '127.0.0.1:4041'});
      expect(peer.trust, TrustLevel.pairing);
      expect(peer.name, 'mesh-beta');
    });

    test('conflict resolution posts the action wire name', () async {
      respondWithJson = '{"conflict":{"id":2,"status":"RESOLVED",'
          '"resolution":"KEEP_BOTH","relPath":"notes.txt"}}';
      final c = await apiFor().resolveConflict(
        conflictId: 2,
        action: ConflictResolution.keepBoth,
      );
      expect(recorded.single.uri.path, '/api/v1/conflicts/2/resolve');
      expect(jsonDecode(recorded.single.body!), {'action': 'KEEP_BOTH'});
      expect(c.resolution, ConflictResolution.keepBoth);
    });

    test('transfer action posts to the pause endpoint', () async {
      respondWithJson =
          '{"transfer":{"id":"t-1","status":"PAUSED","direction":"PUSH"}}';
      final t = await apiFor().transferAction('t-1', TransferAction.pause);
      expect(recorded.single.method, 'POST');
      expect(recorded.single.uri.path, '/api/v1/transfers/t-1/pause');
      expect(t.status, TransferStatus.paused);
    });

    test('query parameters are encoded for lists (folder/path)', () async {
      respondWithJson = '{"entries":[]}';
      await apiFor().listFiles(folderId: 3, path: 'docs/notes');
      final q = recorded.single.uri.queryParameters;
      expect(q['folder'], '3');
      expect(q['path'], isNotEmpty); // path component present
      expect(recorded.single.uri.path, '/api/v1/files');
    });

    test('gateway mode appends XTransformPort to every URL', () async {
      respondWithJson = '{"status":"ok","dbOk":true}';
      await apiFor(viaGateway: true).getHealth();
      expect(
        recorded.single.uri.queryParameters['XTransformPort'],
        '${server.port}',
      );
    });

    test('bearer token is attached when configured', () async {
      respondWithJson = '{"status":"ok","dbOk":true}';
      await apiFor(token: 's3cret').getHealth();
      expect(recorded.single.authorization, 'Bearer s3cret');
    });

    test('agent error envelope becomes AgentApiException', () async {
      respondStatus = 404;
      respondWithJson =
          '{"error":{"code":"PEER_NOT_FOUND","message":"peer 9f2c is not known"}}';
      final api = apiFor();
      await expectLater(
        api.approvePeer('9f2c'),
        throwsA(
          isA<AgentApiException>()
              .having((e) => e.code, 'code', 'PEER_NOT_FOUND')
              .having((e) => e.statusCode, 'statusCode', 404)
              .having((e) => e.message, 'message', contains('not known')),
        ),
      );
    });

    test('204 No Content maps to a silent success (removePeer)', () async {
      respondStatus = 204;
      await expectLater(apiFor().removePeer('ec36'), completes);
      expect(recorded.single.method, 'DELETE');
      expect(recorded.single.uri.path, '/api/v1/peers/ec36');
    });

    test('connection refused surfaces as AgentUnreachableException',
        () async {
      final deadPort = await _findDeadPort();
      final api = AgentApi(
        host: '127.0.0.1',
        port: deadPort,
        timeout: const Duration(milliseconds: 600),
      );
      // GETs retry once, so both attempts must fail first.
      await expectLater(
        api.getHealth(),
        throwsA(isA<AgentUnreachableException>()),
      );
    }, timeout: const Timeout(Duration(seconds: 20)));

    test('describeAgentError gives readable text for both failure kinds',
        () {
      final api = AgentApiException(
        code: 'IO_ERROR',
        message: 'disk exploded',
        statusCode: 500,
      );
      expect(describeAgentError(api), contains('disk exploded'));
      final unreachable =
          AgentUnreachableException('127.0.0.1', 3040, 'no route');
      expect(describeAgentError(unreachable), contains('3040'));
    });
  });
}

/// Simple request recorder for assertions.
class RecordedRequest {
  const RecordedRequest({
    required this.method,
    required this.uri,
    required this.body,
    this.contentType,
    this.authorization,
  });

  final String method;
  final Uri uri;
  final String? contentType;
  final String? authorization;
  final String? body;
}

/// Binds and immediately closes a server to find an unused port.
Future<int> _findDeadPort() async {
  final probe = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final port = probe.port;
  await probe.close(force: true);
  return port;
}
