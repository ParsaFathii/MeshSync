/// Transfer tile: real progress bar, speed, ETA, chunk counters and
/// pause / resume / cancel / retry actions gated by transfer status.
library;

import 'package:flutter/material.dart';

import '../l10n/strings.dart';
import '../models/models.dart';
import '../util/format.dart';

/// Progress-bar / status color per transfer status.
Color transferStatusColor(TransferStatus status, ColorScheme scheme) {
  switch (status) {
    case TransferStatus.queued:
      return scheme.outline;
    case TransferStatus.preparing:
      return scheme.primary;
    case TransferStatus.transferring:
      return scheme.primary;
    case TransferStatus.verifying:
      return Colors.teal;
    case TransferStatus.paused:
      return Colors.amber.shade700;
    case TransferStatus.completed:
      return Colors.green.shade600;
    case TransferStatus.failed:
      return scheme.error;
    case TransferStatus.cancelled:
      return scheme.outline;
  }
}

/// Whether the status chip uses high-emphasis styling.
bool _isEmphasized(TransferStatus status) =>
    status == TransferStatus.failed || status == TransferStatus.completed;

class TransferTile extends StatelessWidget {
  const TransferTile({
    super.key,
    required this.transfer,
    required this.strings,
    this.onPause,
    this.onResume,
    this.onCancel,
    this.onRetry,
  });

  final Transfer transfer;
  final AppStrings strings;

  final VoidCallback? onPause;
  final VoidCallback? onResume;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;

  bool get _canPause =>
      transfer.status == TransferStatus.queued ||
      transfer.status == TransferStatus.preparing ||
      transfer.status == TransferStatus.transferring;

  bool get _canCancel => transfer.status.isActive && transfer.status != TransferStatus.verifying;

  bool get _canResume => transfer.status == TransferStatus.paused;

  bool get _canRetry => transfer.status == TransferStatus.failed;

  double get _progressValue {
    if (transfer.status == TransferStatus.completed) return 1;
    return transfer.progressPct / 100;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final status = transfer.status;
    final color = transferStatusColor(status, scheme);
    final directionIcon = transfer.direction == TransferDirection.push
        ? Icons.upload_outlined
        : Icons.download_outlined;
    final directionText = directionLabel(transfer.direction, strings);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(directionIcon, size: 20, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        transfer.relPath,
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                        textDirection: TextDirection.ltr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '$directionText • ${transfer.peerName} • ${transfer.folderName}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  key: const ValueKey('transfer-status-chip'),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: _isEmphasized(status) ? color : color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    transferStatusLabel(status, strings),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: _isEmphasized(status) ? Colors.white : color,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              key: const ValueKey('transfer-progress'),
              value: _progressValue,
              minHeight: 6,
              borderRadius: BorderRadius.circular(3),
              backgroundColor: scheme.surfaceContainerHighest,
              color: color,
            ),
            const SizedBox(height: 6),
            Text(
              '${formatBytes(transfer.transferred)} / ${formatBytes(transfer.size)}'
              '${transfer.speedBps > 0 ? ' • ${formatSpeed(transfer.speedBps)}' : ''}'
              '${transfer.etaSeconds != null && status.isActive ? ' • ${strings.etaLabel} ${formatEta(transfer.etaSeconds)}' : ''}'
              ' • ${strings.chunksProgressLabel} ${transfer.chunksDone}/${transfer.chunksTotal}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
              textDirection: TextDirection.ltr,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (transfer.error != null && transfer.error!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                '${strings.transferErrorLabel}: ${transfer.error}',
                key: const ValueKey('transfer-error'),
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (_canPause ||
                _canResume ||
                _canCancel ||
                _canRetry) ...[
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (_canResume && onResume != null)
                    IconButton(
                      key: const ValueKey('transfer-resume'),
                      tooltip: strings.resume,
                      onPressed: onResume,
                      icon: const Icon(Icons.play_arrow_outlined),
                    ),
                  if (_canPause && onPause != null)
                    IconButton(
                      key: const ValueKey('transfer-pause'),
                      tooltip: strings.pause,
                      onPressed: onPause,
                      icon: const Icon(Icons.pause_outlined),
                    ),
                  if (_canRetry && onRetry != null)
                    IconButton(
                      key: const ValueKey('transfer-retry'),
                      tooltip: strings.retryTransfer,
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh),
                    ),
                  if (_canCancel && onCancel != null)
                    IconButton(
                      key: const ValueKey('transfer-cancel'),
                      tooltip: strings.cancelTransfer,
                      onPressed: onCancel,
                      icon: const Icon(Icons.close),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
