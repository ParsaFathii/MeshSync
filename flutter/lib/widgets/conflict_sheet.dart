/// Conflict resolution sheet: local vs remote (sizes, times, hashes) with
/// Keep Local / Keep Remote / Keep Both / Resolve Later actions.
library;

import 'package:flutter/material.dart';

import '../l10n/strings.dart';
import '../models/models.dart';
import '../util/format.dart';

/// Body of the conflict sheet — a public widget so tests can render it
/// directly and assert on the actions.
class ConflictSheetBody extends StatelessWidget {
  const ConflictSheetBody({
    super.key,
    required this.conflict,
    required this.strings,
    required this.onResolve,
  });

  final Conflict conflict;
  final AppStrings strings;

  /// Invoked with the chosen resolution. The caller performs the API call
  /// (`POST /api/v1/conflicts/{id}/resolve`) and closes the sheet.
  final ValueChanged<ConflictResolution> onResolve;

  Widget _versionCell(
    BuildContext context, {
    required String title,
    required String? hash,
    required int? size,
    required String? mtime,
  }) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: theme.textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: scheme.primary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '${strings.sizeLabel}: ${formatBytes(size)}',
              style: theme.textTheme.bodySmall,
              textDirection: TextDirection.ltr,
            ),
            Text(
              '${strings.modifiedLabel}: ${formatTimestamp(mtime)}',
              style: theme.textTheme.bodySmall,
              textDirection: TextDirection.ltr,
            ),
            Text(
              'SHA-256: ${shortHash(hash)}',
              key: ValueKey('conflict-hash-${title.contains(strings.localVersionLabel) ? 'local' : 'remote'}'),
              style: theme.textTheme.bodySmall?.copyWith(
                fontFamily: 'monospace',
              ),
              textDirection: TextDirection.ltr,
            ),
          ],
        ),
      ),
    );
  }

  Widget _action(
    BuildContext context, {
    required Key key,
    required String label,
    required String description,
    required IconData icon,
    required ConflictResolution resolution,
    Color? color,
  }) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        key: key,
        borderRadius: BorderRadius.circular(8),
        onTap: () => onResolve(resolution),
        child: InputDecorator(
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
          child: Row(
            children: [
              Icon(icon, color: color ?? theme.colorScheme.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: theme.textTheme.titleSmall),
                    Text(
                      description,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              strings.resolveConflictTitle,
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              conflict.relPath,
              key: const ValueKey('conflict-relpath'),
              style: theme.textTheme.titleMedium,
              textDirection: TextDirection.ltr,
            ),
            Text(
              '${conflict.folderName} • ${strings.createdLabel}: ${formatTimestamp(conflict.createdAt)}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              textDirection: TextDirection.ltr,
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _versionCell(
                  context,
                  title: '${strings.localVersionLabel} (${strings.onDevice})',
                  hash: conflict.localHash,
                  size: conflict.localSize,
                  mtime: conflict.localMtime,
                ),
                const SizedBox(width: 8),
                _versionCell(
                  context,
                  title: strings.remoteVersionFrom(conflict.remotePeerName),
                  hash: conflict.remoteHash,
                  size: conflict.remoteSize,
                  mtime: conflict.remoteMtime,
                ),
              ],
            ),
            const SizedBox(height: 16),
            _action(
              context,
              key: const ValueKey('conflict-keep-local'),
              label: strings.keepLocalBtn,
              description: strings.keepLocalDesc,
              icon: Icons.computer_outlined,
              resolution: ConflictResolution.keepLocal,
            ),
            _action(
              context,
              key: const ValueKey('conflict-keep-remote'),
              label: strings.keepRemoteBtn,
              description: strings.keepRemoteDesc,
              icon: Icons.devices_other,
              resolution: ConflictResolution.keepRemote,
            ),
            _action(
              context,
              key: const ValueKey('conflict-keep-both'),
              label: strings.keepBothBtn,
              description: strings.keepBothDesc,
              icon: Icons.call_split,
              resolution: ConflictResolution.keepBoth,
            ),
            _action(
              context,
              key: const ValueKey('conflict-later'),
              label: strings.laterBtn,
              description: strings.laterDesc,
              icon: Icons.schedule,
              resolution: ConflictResolution.later,
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens the conflict sheet; resolves via [resolve] and pops when it
/// completes, surfacing typed errors to the caller's error handler.
Future<void> showConflictSheet(
  BuildContext context, {
  required Conflict conflict,
  required AppStrings strings,
  required Future<void> Function(ConflictResolution action) resolve,
  void Function(Object error)? onError,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => ConflictSheetBody(
      conflict: conflict,
      strings: strings,
      onResolve: (action) async {
        try {
          await resolve(action);
          if (sheetContext.mounted) {
            Navigator.of(sheetContext).pop();
          }
        } catch (error) {
          onError?.call(error);
          // Keep the sheet open so the user can retry or choose LATER.
        }
      },
    ),
  );
}
