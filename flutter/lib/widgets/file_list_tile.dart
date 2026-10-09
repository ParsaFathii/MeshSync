/// File / directory row with a sync-state badge and remote-copy count.
library;

import 'package:flutter/material.dart';

import '../l10n/strings.dart';
import '../models/models.dart';
import '../util/format.dart';

/// Badge color per file sync state.
Color syncStateColor(FileSyncState state, ColorScheme scheme) {
  switch (state) {
    case FileSyncState.synced:
      return Colors.green.shade600;
    case FileSyncState.pending:
      return Colors.amber.shade700;
    case FileSyncState.syncing:
      return scheme.primary;
    case FileSyncState.conflict:
      return scheme.error;
    case FileSyncState.localOnly:
      return scheme.outline;
  }
}

class FileListTile extends StatelessWidget {
  const FileListTile({
    super.key,
    required this.entry,
    required this.strings,
    this.onTap,
  });

  final FileEntry entry;
  final AppStrings strings;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final isFile = !entry.isDir;

    final subtitle = isFile
        ? '${formatBytes(entry.size)} • ${formatTimestamp(entry.mtime)}'
        : '${strings.filesCount(entry.fileCount)} • ${formatBytes(entry.totalBytes)}';

    return ListTile(
      key: ValueKey('file-tile-${entry.name}'),
      leading: Icon(
        entry.isDir ? Icons.folder_outlined : Icons.insert_drive_file_outlined,
        color: entry.isDir ? scheme.primary : scheme.onSurfaceVariant,
      ),
      title: Text(
        entry.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        textDirection: TextDirection.ltr,
      ),
      subtitle: Text(
        subtitle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        textDirection: TextDirection.ltr,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isFile && entry.remotePeers.isNotEmpty) ...[
            Row(
              key: const ValueKey('file-peer-copies'),
              children: [
                Icon(Icons.cloud_done_outlined,
                    size: 16, color: scheme.onSurfaceVariant),
                const SizedBox(width: 2),
                Text(
                  strings.num(entry.remotePeers.length),
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(width: 8),
          ],
          if (isFile && entry.syncState != null)
            Container(
              key: const ValueKey('file-sync-badge'),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: syncStateColor(entry.syncState!, scheme)
                    .withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                fileSyncStateLabel(entry.syncState, strings),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: syncStateColor(entry.syncState!, scheme),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
      onTap: onTap,
    );
  }
}
