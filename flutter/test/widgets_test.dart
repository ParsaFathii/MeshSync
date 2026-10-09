/// Widget tests for the core MeshSync UI components: peer cards, transfer
/// tiles across their lifecycle, and the conflict resolution sheet.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:meshsync/l10n/strings.dart';
import 'package:meshsync/models/models.dart';
import 'package:meshsync/widgets/conflict_sheet.dart';
import 'package:meshsync/widgets/peer_card.dart';
import 'package:meshsync/widgets/transfer_tile.dart';

Peer _peer({
  String name = 'mesh-beta',
  TrustLevel trust = TrustLevel.trusted,
  bool online = true,
}) =>
    Peer.fromJson({
      'peerId': '31aa0c44bb55ff90',
      'name': name,
      'address': '127.0.0.1:4041',
      'trust': trust.wireName,
      'online': online,
      'version': '0.1.0',
      'platform': 'linux/amd64',
      'lastSeen': DateTime.now().toUtc().toIso8601String(),
      'addedAt': '2026-10-07T18:20:01Z',
      'sharedFolders': 1,
    });

Transfer _transfer({
  TransferStatus status = TransferStatus.transferring,
  TransferDirection direction = TransferDirection.push,
  int progressPct = 50,
  String? error,
}) =>
    Transfer.fromJson({
      'id': 't-x',
      'peerId': '31aa',
      'peerName': 'mesh-beta',
      'folderId': 1,
      'folderName': 'Documents',
      'relPath': 'report.pdf',
      'direction': direction.wireName,
      'size': 67108864,
      'transferred': (67108864 * progressPct / 100).round(),
      'progressPct': progressPct,
      'speedBps': 8388608,
      'etaSeconds': 4,
      'status': status.wireName,
      'chunkSize': 1048576,
      'chunksDone': (64 * progressPct / 100).round(),
      'chunksTotal': 64,
      'startedAt': '2026-10-09T15:35:55Z',
      'completedAt': status.isTerminal ? '2026-10-09T15:35:56Z' : '',
      'error': error,
    });

Conflict _conflict({ConflictStatus status = ConflictStatus.open}) =>
    Conflict.fromJson({
      'id': 2,
      'folderId': 1,
      'folderName': 'Documents',
      'relPath': 'notes.txt',
      'localHash': 'a7b5bfe2da111d21',
      'remoteHash': '6039a7b1b1859ff6',
      'localMtime': '2026-10-09T15:39:49Z',
      'remoteMtime': '2026-10-09T15:39:49Z',
      'localSize': 47,
      'remoteSize': 51,
      'remotePeerId': 'ec365de7ff166c54',
      'remotePeerName': 'mesh-beta',
      'status': status.wireName,
      'resolution': null,
      'createdAt': '2026-10-09T15:39:49Z',
      'resolvedAt': '',
    });

Future<void> _pump(
  WidgetTester tester,
  Widget child,
) =>
    tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(useMaterial3: true),
        home: Scaffold(body: child),
      ),
    );

void main() {
  testWidgets('PeerCard renders identity, trust badge and online dot',
      (tester) async {
    await _pump(
      tester,
      PeerCard(peer: _peer(), strings: AppStrings.en),
    );
    expect(find.text('mesh-beta'), findsOneWidget);
    expect(find.byKey(const ValueKey('peer-online-dot')), findsOneWidget);
    expect(find.byKey(const ValueKey('peer-trust-badge')), findsOneWidget);
    expect(find.byKey(const ValueKey('peer-menu')), findsNothing);
  });

  testWidgets('PeerCard for a pairing peer offers approve and calls back',
      (tester) async {
    var approved = 0;
    await _pump(
      tester,
      PeerCard(
        peer: _peer(trust: TrustLevel.pairing, online: false),
        strings: AppStrings.en,
        onApprove: () => approved++,
      ),
    );
    // Waiting-for-approval hint is visible for PAIRING peers.
    expect(find.text(AppStrings.en.waitingForApproval), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('peer-menu')));
    await tester.pumpAndSettle();

    await tester.tap(find.text(AppStrings.en.approve).last);
    await tester.pumpAndSettle();
    expect(approved, 1);
  });

  testWidgets('PeerCard menu exposes revoke for trusted peers',
      (tester) async {
    var revoked = 0;
    await _pump(
      tester,
      PeerCard(
        peer: _peer(),
        strings: AppStrings.en,
        onRevoke: () => revoked++,
        onRemove: () {},
      ),
    );
    await tester.tap(find.byKey(const ValueKey('peer-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.en.revoke).last);
    await tester.pumpAndSettle();
    expect(revoked, 1);
  });

  testWidgets('TransferTile shows progress, speed and chunk counts',
      (tester) async {
    await _pump(
      tester,
      SingleChildScrollView(
        child: TransferTile(
          transfer: _transfer(progressPct: 50),
          strings: AppStrings.en,
          onPause: () {},
          onCancel: () {},
        ),
      ),
    );
    expect(find.text('report.pdf'), findsOneWidget);
    expect(find.byKey(const ValueKey('transfer-progress')), findsOneWidget);
    expect(find.textContaining('32/64'), findsOneWidget); // chunk progress
    expect(find.byKey(const ValueKey('transfer-pause')), findsOneWidget);
    expect(find.byKey(const ValueKey('transfer-cancel')), findsOneWidget);
    // No error row without an error.
    expect(find.byKey(const ValueKey('transfer-error')), findsNothing);
  });

  testWidgets('TransferTile pause button invokes the callback',
      (tester) async {
    var paused = 0;
    await _pump(
      tester,
      SingleChildScrollView(
        child: TransferTile(
          transfer: _transfer(),
          strings: AppStrings.en,
          onPause: () => paused++,
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('transfer-pause')));
    expect(paused, 1);
  });

  testWidgets('TransferTile shows resume for paused transfers and retry for failed',
      (tester) async {
    await _pump(
      tester,
      SingleChildScrollView(
        child: TransferTile(
          transfer: _transfer(status: TransferStatus.paused),
          strings: AppStrings.en,
          onResume: () {},
          onCancel: () {},
        ),
      ),
    );
    expect(find.byKey(const ValueKey('transfer-resume')), findsOneWidget);
    expect(find.byKey(const ValueKey('transfer-pause')), findsNothing);

    await _pump(
      tester,
      SingleChildScrollView(
        child: TransferTile(
          transfer: _transfer(
            status: TransferStatus.failed,
            error: 'peer: IO_ERROR: short read',
          ),
          strings: AppStrings.en,
          onRetry: () {},
        ),
      ),
    );
    expect(find.byKey(const ValueKey('transfer-retry')), findsOneWidget);
    expect(find.byKey(const ValueKey('transfer-error')), findsOneWidget);
    expect(find.textContaining('short read'), findsOneWidget);
  });

  testWidgets('TransferTile completed transfer shows no action buttons',
      (tester) async {
    await _pump(
      tester,
      SingleChildScrollView(
        child: TransferTile(
          transfer: _transfer(status: TransferStatus.completed, progressPct: 100),
          strings: AppStrings.en,
          onPause: () {},
          onResume: () {},
          onCancel: () {},
          onRetry: () {},
        ),
      ),
    );
    expect(find.byKey(const ValueKey('transfer-pause')), findsNothing);
    expect(find.byKey(const ValueKey('transfer-cancel')), findsNothing);
    expect(find.byKey(const ValueKey('transfer-retry')), findsNothing);
  });

  testWidgets('ConflictSheetBody renders both versions and all four actions',
      (tester) async {
    final resolutions = <ConflictResolution>[];
    await _pump(
      tester,
      SingleChildScrollView(
        child: ConflictSheetBody(
          conflict: _conflict(),
          strings: AppStrings.en,
          onResolve: resolutions.add,
        ),
      ),
    );
    expect(find.textContaining('mesh-beta'), findsWidgets);
    expect(find.byKey(const ValueKey('conflict-keep-local')), findsOneWidget);
    expect(find.byKey(const ValueKey('conflict-keep-remote')), findsOneWidget);
    expect(find.byKey(const ValueKey('conflict-keep-both')), findsOneWidget);
    expect(find.byKey(const ValueKey('conflict-later')), findsOneWidget);
  });

  testWidgets('ConflictSheetBody reports the chosen resolution',
      (tester) async {
    ConflictResolution? chosen;
    await _pump(
      tester,
      SingleChildScrollView(
        child: ConflictSheetBody(
          conflict: _conflict(),
          strings: AppStrings.en,
          onResolve: (r) => chosen = r,
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('conflict-keep-both')));
    await tester.pumpAndSettle();
    expect(chosen, ConflictResolution.keepBoth);

    await tester.tap(find.byKey(const ValueKey('conflict-later')));
    await tester.pumpAndSettle();
    expect(chosen, ConflictResolution.later);
  });
}
