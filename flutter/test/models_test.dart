/// Model parsing tests against real contract shapes (docs/API.md) and
/// defensively against garbage inputs.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:meshsync/models/models.dart';

void main() {
  group('Health', () {
    test('parses the contract sample', () {
      const raw = {
        'status': 'ok',
        'version': '0.1.0',
        'uptimeSeconds': 1284,
        'dbOk': true,
      };
      final h = Health.fromJson(raw);
      expect(h.status, 'ok');
      expect(h.version, '0.1.0');
      expect(h.uptimeSeconds, 1284);
      expect(h.dbOk, isTrue);
    });

    test('degrades on wrong shapes without throwing', () {
      final h = Health.fromJson('nonsense');
      expect(h.status, 'unknown');
      expect(h.version, '');
      expect(h.uptimeSeconds, 0);
      expect(h.dbOk, isFalse);
    });

    test('accepts string-encoded numbers', () {
      final h = Health.fromJson({'uptimeSeconds': '42'});
      expect(h.uptimeSeconds, 42);
    });
  });

  group('Peer', () {
    test('parses the contract sample', () {
      const raw = {
        'peerId': '31aa0c44bb55ff90',
        'name': 'mesh-beta',
        'address': '127.0.0.1:4041',
        'trust': 'TRUSTED',
        'online': true,
        'version': '0.1.0',
        'platform': 'linux/amd64',
        'lastSeen': '2026-10-08T10:04:12Z',
        'addedAt': '2026-10-07T18:20:01Z',
        'sharedFolders': 1,
      };
      final p = Peer.fromJson(raw);
      expect(p.peerId, '31aa0c44bb55ff90');
      expect(p.name, 'mesh-beta');
      expect(p.trust, TrustLevel.trusted);
      expect(p.online, isTrue);
      expect(p.sharedFolders, 1);
    });

    test('unknown trust falls back to discovered, never throws', () {
      final p = Peer.fromJson({'trust': 'SOMETHING_ELSE'});
      expect(p.trust, TrustLevel.discovered);
      expect(p.online, isFalse);
      expect(p.sharedFolders, 0);
    });

    test('parses every trust state from the wire', () {
      for (final entry in {
        'DISCOVERED': TrustLevel.discovered,
        'PAIRING': TrustLevel.pairing,
        'TRUSTED': TrustLevel.trusted,
        'REVOKED': TrustLevel.revoked,
      }.entries) {
        expect(TrustLevel.parse(entry.key), entry.value,
            reason: entry.key);
      }
    });
  });

  group('Transfer', () {
    const completed = {
      'id': 't-a6ac61299a162925',
      'peerId': 'ec365de7ff166c54',
      'peerName': 'mesh-beta',
      'folderId': 1,
      'folderName': 'Documents',
      'relPath': 'big-dataset.bin',
      'direction': 'PUSH',
      'size': 67108864,
      'transferred': 67108864,
      'progressPct': 100,
      'speedBps': 0,
      'etaSeconds': 0,
      'status': 'COMPLETED',
      'chunkSize': 1048576,
      'chunksDone': 64,
      'chunksTotal': 64,
      'startedAt': '2026-10-09T15:35:55Z',
      'completedAt': '2026-10-09T15:35:56Z',
      'error': null,
    };

    test('parses a completed 64 MiB push with 64 chunks', () {
      final t = Transfer.fromJson(completed);
      expect(t.id, 't-a6ac61299a162925');
      expect(t.status, TransferStatus.completed);
      expect(t.direction, TransferDirection.push);
      expect(t.chunksDone, 64);
      expect(t.chunksTotal, 64);
      expect(t.transferred, t.size);
      expect(t.error, isNull);
    });

    test('parses a transferring pull with live progress', () {
      final t = Transfer.fromJson({
        ...completed,
        'direction': 'PULL',
        'status': 'TRANSFERRING',
        'transferred': 33554432,
        'progressPct': 50,
        'speedBps': 8388608,
        'etaSeconds': 4,
        'completedAt': '',
      });
      expect(t.status, TransferStatus.transferring);
      expect(t.direction, TransferDirection.pull);
      expect(t.transferred, 33554432);
      expect(t.speedBps, 8388608);
      expect(t.status.isActive, isTrue);
      expect(t.status.isTerminal, isFalse);
    });

    test('parses a failed transfer with its error message', () {
      final t = Transfer.fromJson({
        ...completed,
        'status': 'FAILED',
        'error': 'peer: IO_ERROR: short read',
      });
      expect(t.status, TransferStatus.failed);
      expect(t.error, contains('short read'));
      expect(t.status.isTerminal, isTrue);
    });

    test('every transfer status maps from the wire name', () {
      const wire = {
        'QUEUED': TransferStatus.queued,
        'PREPARING': TransferStatus.preparing,
        'TRANSFERRING': TransferStatus.transferring,
        'VERIFYING': TransferStatus.verifying,
        'PAUSED': TransferStatus.paused,
        'COMPLETED': TransferStatus.completed,
        'FAILED': TransferStatus.failed,
        'CANCELLED': TransferStatus.cancelled,
      };
      for (final e in wire.entries) {
        expect(TransferStatus.parse(e.key), e.value, reason: e.key);
      }
    });

    test('unknown status is safe (queued) and empty body degrades', () {
      expect(TransferStatus.parse('WHAT'), TransferStatus.queued);
      final t = Transfer.fromJson(null);
      expect(t.status, TransferStatus.queued);
      expect(t.size, 0);
    });
  });

  group('Conflict', () {
    const sample = {
      'id': 2,
      'folderId': 1,
      'folderName': 'Documents',
      'relPath': 'notes.txt',
      'localHash': 'a7b5bfe2da111d21643d683933a2bcde4f89e148cc809e750be4524cdb0c314b',
      'remoteHash': '6039a7b1b1859ff6cb2347eb694def2fa4258fd942e261260963a4abcbcad758',
      'localMtime': '2026-10-09T15:39:49Z',
      'remoteMtime': '2026-10-09T15:39:49Z',
      'localSize': 47,
      'remoteSize': 51,
      'remotePeerId': 'ec365de7ff166c54',
      'remotePeerName': 'mesh-beta',
      'status': 'OPEN',
      'resolution': null,
      'createdAt': '2026-10-09T15:39:49Z',
      'resolvedAt': '',
    };

    test('parses an open conflict with both versions', () {
      final c = Conflict.fromJson(sample);
      expect(c.id, 2);
      expect(c.status, ConflictStatus.open);
      expect(c.relPath, 'notes.txt');
      expect(c.localSize, 47);
      expect(c.remoteSize, 51);
      expect(c.resolution, isNull);
    });

    test('parses a resolved conflict with its action', () {
      final c = Conflict.fromJson({
        ...sample,
        'status': 'RESOLVED',
        'resolution': 'KEEP_BOTH',
      });
      expect(c.status, ConflictStatus.resolved);
      expect(c.resolution, ConflictResolution.keepBoth);
    });

    test('unknown resolution value stays null', () {
      final c = Conflict.fromJson({...sample, 'resolution': 'MAYBE'});
      expect(c.resolution, isNull);
    });
  });

  group('SyncPlan', () {
    test('parses summary and actions', () {
      final plan = SyncPlan.fromJson({
        'peer': {'peerId': 'ec365de7ff166c54', 'name': 'mesh-beta'},
        'folder': {'id': 1, 'name': 'Documents'},
        'generatedAt': '2026-10-09T15:35:49Z',
        'summary': {
          'total': 4,
          'pull': 1,
          'push': 2,
          'deleteLocal': 0,
          'deleteRemote': 1,
          'conflicts': 1,
          'unchanged': 0,
        },
        'actions': [
          {
            'relPath': 'big-dataset.bin',
            'state': 'LOCAL_ONLY',
            'direction': 'PUSH',
            'size': 67108864,
            'localHash': '37d5ebb8',
            'remoteHash': '',
            'lastSyncedHash': '',
          },
          {
            'relPath': 'notes.txt',
            'state': 'CONFLICT',
            'direction': 'NONE',
            'size': 47,
            'localHash': 'a7b5',
            'remoteHash': '6039',
            'lastSyncedHash': 'a466',
          },
        ],
      });
      expect(plan.peerName, 'mesh-beta');
      expect(plan.folder.name, 'Documents');
      expect(plan.summary.total, 4);
      expect(plan.summary.conflicts, 1);
      expect(plan.actions, hasLength(2));
      expect(plan.actions.first.state, PlanActionState.localOnly);
      expect(plan.actions.last.state, PlanActionState.conflict);
    });

    test('every plan state maps from the wire name', () {
      const wire = {
        'UNCHANGED': PlanActionState.unchanged,
        'LOCAL_ONLY': PlanActionState.localOnly,
        'REMOTE_ONLY': PlanActionState.remoteOnly,
        'LOCAL_MODIFIED': PlanActionState.localModified,
        'REMOTE_MODIFIED': PlanActionState.remoteModified,
        'CONFLICT': PlanActionState.conflict,
        'DELETE_LOCAL': PlanActionState.deleteLocal,
        'DELETE_REMOTE': PlanActionState.deleteRemote,
      };
      for (final e in wire.entries) {
        expect(PlanActionState.parse(e.key), e.value, reason: e.key);
      }
    });
  });

  group('AgentEvent', () {
    test('parses type, severity and data block', () {
      final e = AgentEvent.fromJson({
        'id': 9,
        'type': 'CONFLICT_DETECTED',
        'severity': 'WARN',
        'message': 'Conflict on Documents/notes.txt',
        'ts': '2026-10-09T15:39:49Z',
        'data': {'folder': 'Documents', 'path': 'notes.txt'},
      });
      expect(e.id, 9);
      expect(e.severity, EventSeverity.warn);
      expect(e.data?['path'], 'notes.txt');
    });

    test('null data block is fine; bad severity falls back to info', () {
      final e = AgentEvent.fromJson({'id': 1, 'type': 'X'});
      expect(e.data, isNull);
      expect(e.severity, EventSeverity.info);
    });
  });

  group('DeviceInfo', () {
    test('parses stats block including native engine', () {
      final d = DeviceInfo.fromJson({
        'peerId': 'd1336a5f58abbabb',
        'name': 'mesh-alpha',
        'version': '0.1.0',
        'platform': 'linux/amd64',
        'startedAt': '2026-10-09T15:34:07Z',
        'apiPort': 3040,
        'peerPort': 4040,
        'keyFingerprint': 'SHA256:0TNqX1irurtsiwkRVvsHwW8stQ7KzkoWX',
        'nativeEngine': 'cpp-worker-1.0.0',
        'stats': {
          'folders': 1,
          'filesIndexed': 2,
          'bytesIndexed': 67108938,
          'peersTrusted': 1,
          'peersOnline': 1,
          'transfersActive': 0,
          'transfersCompleted': 2,
          'conflictsOpen': 0,
          'lastSyncAt': '2026-10-09T15:35:56Z',
        },
      });
      expect(d.name, 'mesh-alpha');
      expect(d.apiPort, 3040);
      expect(d.nativeEngine, 'cpp-worker-1.0.0');
      expect(d.stats.filesIndexed, 2);
      expect(d.stats.transfersCompleted, 2);
    });
  });
}
