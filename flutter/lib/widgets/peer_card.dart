/// Peer card: name, peer id, trust badge, online dot, version, last seen,
/// shared folder count, and contextual actions (approve / revoke / remove).
library;

import 'package:flutter/material.dart';

import '../l10n/strings.dart';
import '../models/models.dart';
import '../util/format.dart';

/// Background color for each trust badge.
Color trustBadgeColor(TrustLevel trust, ColorScheme scheme) {
  switch (trust) {
    case TrustLevel.trusted:
      return Colors.green.shade700;
    case TrustLevel.pairing:
      return Colors.amber.shade800;
    case TrustLevel.discovered:
      return Colors.blueGrey;
    case TrustLevel.revoked:
      return scheme.error;
  }
}

class PeerCard extends StatelessWidget {
  const PeerCard({
    super.key,
    required this.peer,
    required this.strings,
    this.onApprove,
    this.onRevoke,
    this.onRemove,
    this.now,
  });

  final Peer peer;
  final AppStrings strings;

  /// Approve action — only offered for PAIRING peers.
  final VoidCallback? onApprove;

  /// Revoke action — offered for TRUSTED / PAIRING peers.
  final VoidCallback? onRevoke;

  /// Remove action — always offered.
  final VoidCallback? onRemove;

  /// Optional clock override (tests).
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final canRevoke =
        peer.trust == TrustLevel.trusted || peer.trust == TrustLevel.pairing;
    final canApprove = peer.trust == TrustLevel.pairing;
    final hasMenu = onApprove != null || onRevoke != null || onRemove != null;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: canApprove ? onApprove : null,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Container(
                  key: const ValueKey('peer-online-dot'),
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: peer.online ? Colors.green : scheme.outlineVariant,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            peer.name,
                            style: theme.textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          key: const ValueKey('peer-trust-badge'),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: trustBadgeColor(peer.trust, scheme),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            trustLabel(peer.trust, strings),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        if (hasMenu) ...[
                          PopupMenuButton<_PeerAction>(
                            key: const ValueKey('peer-menu'),
                            onSelected: (_PeerAction action) {
                              switch (action) {
                                case _PeerAction.approve:
                                  onApprove?.call();
                                case _PeerAction.revoke:
                                  onRevoke?.call();
                                case _PeerAction.remove:
                                  onRemove?.call();
                              }
                            },
                            itemBuilder: (context) => [
                              if (canApprove && onApprove != null)
                                PopupMenuItem(
                                  value: _PeerAction.approve,
                                  child: Text(strings.approve),
                                ),
                              if (canRevoke && onRevoke != null)
                                PopupMenuItem(
                                  value: _PeerAction.revoke,
                                  child: Text(strings.revoke),
                                ),
                              if (onRemove != null)
                                PopupMenuItem(
                                  value: _PeerAction.remove,
                                  child: Text(strings.removePeer),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${strings.peerIdLabel}: ${shortPeerId(peer.peerId)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${peer.version} • ${peer.platform}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${strings.lastSeenLabel}: '
                      '${relativeTime(peer.lastSeen, strings, now: now)}'
                      ' • ${strings.sharedFoldersCount(peer.sharedFolders)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (peer.trust == TrustLevel.pairing) ...[
                      const SizedBox(height: 4),
                      Text(
                        strings.waitingForApproval,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: Colors.amber.shade800,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum _PeerAction { approve, revoke, remove }
