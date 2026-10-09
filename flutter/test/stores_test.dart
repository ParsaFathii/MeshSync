/// Store state-machine tests driven through a real in-process HTTP server,
/// so the full pipeline (store → AgentApi → HTTP → typed model) is covered.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:meshsync/api/agent_api.dart';
import 'package:meshsync/models/models.dart';
import 'package:meshsync/state/load_state.dart';
import 'package:meshsync/state/peers_store.dart';
import 'package:meshsync/state/transfers_store.dart';
import 'package:meshsync/state/conflicts_store.dart';

void main() {
  late HttpServer server;
  String? body;

  setUp(() async {
    body = null;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      await utf8.decoder
          .bind(req)
          .fold<String>('', (prev, chunk) => prev + chunk);
      final res = req.response;
      res.headers.contentType = ContentType.json;
      res.write(body ?? '{}');
      await res.close();
    });
  });

  tearDown(() async {
    await server.close(force: true);
  });

  AgentApi api() => AgentApi(
        host: '127.0.0.1',
        port: server.port,
        timeout: const Duration(seconds: 2),
      );

  group('PeersStore', () {
    test('refresh loads peers and reaches the loaded state', () async {
      body = jsonEncode({
        'peers': [
          {
            'peerId': 'a',
            'name': 'mesh-alpha',
            'trust': 'TRUSTED',
            'online': true,
            'version': '0.1.0',
            'sharedFolders': 1,
          },
          {
            'peerId': 'b',
            'name': 'mesh-beta',
            'trust': 'PAIRING',
            'online': false,
            'version': '0.1.0',
            'sharedFolders': 0,
          },
        ],
      });
      final store = PeersStore(api: api);
      final states = <LoadState>[];
      store.addListener(() => states.add(store.state));
      await store.refresh();

      expect(store.state, LoadState.loaded);
      expect(store.peers, hasLength(2));
      expect(store.trustedPeers.map((p) => p.peerId), ['a']);
      expect(store.pendingPeers.map((p) => p.peerId), ['b']);
      expect(store.error, isNull);
      // idle → loading → loaded
      expect(states, containsAll([LoadState.loading, LoadState.loaded]));
    });

    test('network failure flips the store to the error state with a message',
        () async {
      final port = server.port; // capture before closing
      await server.close(force: true);
      final store = PeersStore(
        api: () => AgentApi(
          host: '127.0.0.1',
          port: port,
          timeout: const Duration(seconds: 2),
        ),
      );
      await store.refresh();
      expect(store.state, LoadState.error);
      expect(store.error, isNotNull);
      expect(store.peers, isEmpty);
    });

    test('pair replaces or adds the returned peer', () async {
      body = jsonEncode({
        'peers': [
          {
            'peerId': 'a',
            'name': 'mesh-alpha',
            'trust': 'TRUSTED',
            'sharedFolders': 0,
          },
        ],
      });
      final store = PeersStore(api: api);
      await store.refresh();

      // The pair endpoint now returns the same peer as PAIRING.
      body = jsonEncode({
        'peer': {
          'peerId': 'a',
          'name': 'mesh-alpha',
          'trust': 'PAIRING',
          'sharedFolders': 0,
        },
      });
      await store.pair('127.0.0.1:4040');
      expect(store.peers, hasLength(1));
      expect(store.peers.single.trust, TrustLevel.pairing);

      // And a brand-new peer gets appended.
      body = jsonEncode({
        'peer': {
          'peerId': 'c',
          'name': 'mesh-gamma',
          'trust': 'PAIRING',
          'sharedFolders': 0,
        },
      });
      await store.pair('127.0.0.1:4042');
      expect(store.peers, hasLength(2));
    });

    test('remove drops the peer from the list', () async {
      body = jsonEncode({
        'peers': [
          {'peerId': 'a', 'name': 'mesh-alpha', 'trust': 'TRUSTED'},
          {'peerId': 'b', 'name': 'mesh-beta', 'trust': 'TRUSTED'},
        ],
      });
      final store = PeersStore(api: api);
      await store.refresh();
      await store.remove('a');
      expect(store.peers.map((p) => p.peerId), ['b']);
    });

    test('WS frame application replaces the list without any HTTP call',
        () async {
      final store = PeersStore(api: api);
      store.applyPeers([
        Peer.fromJson({'peerId': 'z', 'name': 'mesh-zeta', 'trust': 'TRUSTED'}),
      ]);
      expect(store.state, LoadState.loaded);
      expect(store.peers.single.name, 'mesh-zeta');
    });
  });

  group('TransfersStore live updates', () {
    test('WS transfer frames upsert by id and classify active transfers',
        () {
      final store = TransfersStore(api: api);
      store.upsert(Transfer.fromJson({
        'id': 't-1',
        'status': 'TRANSFERRING',
        'progressPct': 50,
        'transferred': 32,
        'size': 64,
        'chunksDone': 32,
        'chunksTotal': 64,
      }));
      // Same id arrives again with more progress — must replace, not append.
      store.upsert(Transfer.fromJson({
        'id': 't-1',
        'status': 'TRANSFERRING',
        'progressPct': 75,
        'transferred': 48,
        'size': 64,
        'chunksDone': 48,
        'chunksTotal': 64,
      }));
      store.upsert(Transfer.fromJson({
        'id': 't-2',
        'status': 'COMPLETED',
        'progressPct': 100,
        'transferred': 10,
        'size': 10,
        'chunksDone': 1,
        'chunksTotal': 1,
      }));
      expect(store.state, LoadState.loaded);
      expect(store.transfers, hasLength(2));
      final t1 = store.transfers.firstWhere((t) => t.id == 't-1');
      expect(t1.progressPct, 75);
      expect(store.activeTransfers.map((t) => t.id), ['t-1']);
      // A paused transfer stays "active" in the lifecycle sense (resumable).
      store.upsert(Transfer.fromJson({
        'id': 't-1',
        'status': 'PAUSED',
        'progressPct': 75,
        'transferred': 48,
        'size': 64,
        'chunksDone': 48,
        'chunksTotal': 64,
      }));
      expect(store.activeTransfers.single.status, TransferStatus.paused);
    });
  });

  group('ConflictsStore', () {
    test('refresh separates open conflicts from resolved history', () async {
      body = jsonEncode({
        'conflicts': [
          {
            'id': 1,
            'relPath': 'readme.txt',
            'status': 'OPEN',
            'localSize': 38,
            'remoteSize': 37,
          },
          {
            'id': 2,
            'relPath': 'notes.txt',
            'status': 'RESOLVED',
            'resolution': 'KEEP_BOTH',
          },
        ],
      });
      final store = ConflictsStore(api: api);
      await store.refresh();
      expect(store.state, LoadState.loaded);
      expect(store.openConflicts.map((c) => c.id), [1]);
      expect(store.resolvedConflicts.map((c) => c.id), [2]);
      expect(store.openConflicts, isNotEmpty);
    });

    test('resolve moves the conflict into history optimistically', () async {
      body = jsonEncode({
        'conflicts': [
          {'id': 1, 'relPath': 'readme.txt', 'status': 'OPEN'},
        ],
      });
      final store = ConflictsStore(api: api);
      await store.refresh();

      body = jsonEncode({
        'conflict': {
          'id': 1,
          'relPath': 'readme.txt',
          'status': 'RESOLVED',
          'resolution': 'KEEP_REMOTE',
        },
      });
      await store.resolve(1, ConflictResolution.keepRemote);
      expect(store.openConflicts, isEmpty);
      expect(store.resolvedConflicts.single.id, 1);
    });
  });
}
