/// Conflicts screen: open conflicts with the resolution sheet, plus the
/// resolved history.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/context_strings.dart';
import '../l10n/strings.dart';
import '../models/models.dart';
import '../state/conflicts_store.dart';
import '../state/load_state.dart';
import '../util/format.dart';
import '../widgets/conflict_sheet.dart';
import '../widgets/state_views.dart';

class ConflictsScreen extends StatefulWidget {
  const ConflictsScreen({super.key});

  @override
  State<ConflictsScreen> createState() => _ConflictsScreenState();
}

class _ConflictsScreenState extends State<ConflictsScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    context.read<ConflictsStore>().refresh();
    _timer = Timer.periodic(
      const Duration(seconds: 4),
      (_) => mounted ? context.read<ConflictsStore>().refresh() : null,
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }

  void _openSheet(Conflict conflict) {
    final store = context.read<ConflictsStore>();
    showConflictSheet(
      context,
      conflict: conflict,
      strings: context.strings,
      resolve: (action) => store.resolve(conflict.id, action),
      onError: _showError,
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final store = context.watch<ConflictsStore>();

    Widget body;
    switch (store.state) {
      case LoadState.idle:
      case LoadState.loading:
        body = const LoadingView();
      case LoadState.error:
        body = ErrorView(
          message: store.error ?? '',
          onRetry: () => store.refresh(),
        );
      case LoadState.loaded:
        final open = store.openConflicts;
        final resolved = store.resolvedConflicts;
        if (open.isEmpty && resolved.isEmpty) {
          body = EmptyView(
            title: strings.conflictsEmptyTitle,
            hint: strings.conflictsEmptyHint,
            icon: Icons.merge_outlined,
          );
        } else {
          body = RefreshIndicator(
            onRefresh: () => store.refresh(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
              children: [
                if (open.isNotEmpty) ...[
                  Text(
                    strings.openConflictsSection,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ...open.map((c) => _conflictTile(context, c, strings)),
                ],
                if (resolved.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    strings.resolvedConflictsSection,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ...resolved.take(20).map(
                        (c) => _resolvedTile(context, c, strings),
                      ),
                ],
              ],
            ),
          );
        }
    }

    return body;
  }

  Widget _conflictTile(BuildContext context, Conflict c, AppStrings strings) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: Icon(Icons.warning_amber_outlined, color: theme.colorScheme.error),
        title: Text(
          c.relPath,
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${c.folderName} • ${c.remotePeerName} • '
          '${formatBytes(c.localSize)} ↔ ${formatBytes(c.remoteSize)} • '
          '${formatTimestamp(c.createdAt)}',
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => _openSheet(c),
      ),
    );
  }

  Widget _resolvedTile(BuildContext context, Conflict c, AppStrings strings) {
    final theme = Theme.of(context);
    final resolution = switch (c.resolution) {
      ConflictResolution.keepLocal => strings.keepLocalBtn,
      ConflictResolution.keepRemote => strings.keepRemoteBtn,
      ConflictResolution.keepBoth => strings.keepBothBtn,
      ConflictResolution.later => strings.laterBtn,
      null => null,
    };
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        dense: true,
        leading: Icon(
          Icons.check_circle_outline,
          color: Colors.green.shade600,
        ),
        title: Text(
          c.relPath,
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.bodyMedium,
        ),
        subtitle: Text(
          '${resolution ?? strings.resolvedLabel} • ${formatTimestamp(c.resolvedAt)}',
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}
