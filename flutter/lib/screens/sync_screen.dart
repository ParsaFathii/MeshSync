/// Sync screen: pick trusted peer + folder, preview the plan, run the sync,
/// and watch recent sessions — all real agent calls.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../l10n/strings.dart';
import '../models/models.dart';
import '../state/conflicts_store.dart';
import '../state/connection_store.dart';
import '../state/folders_store.dart';
import '../state/load_state.dart';
import '../state/peers_store.dart';
import '../util/format.dart';
import '../widgets/state_views.dart';
import 'conflicts_screen.dart';

class SyncScreen extends StatefulWidget {
  const SyncScreen({super.key});

  @override
  State<SyncScreen> createState() => _SyncScreenState();
}

class _SyncScreenState extends State<SyncScreen> {
  String? _peerId;
  int? _folderId;
  SyncPlan? _plan;
  bool _loadingPlan = false;
  bool _running = false;
  List<SyncSession> _sessions = const <SyncSession>[];
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    context.read<PeersStore>().refresh();
    context.read<FoldersStore>().refresh();
    context.read<ConflictsStore>().refresh();
    _refreshSessions();
    _timer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => mounted ? _refreshSessions() : null,
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshSessions() async {
    try {
      final sessions = await context.read<ConnectionStore>().api.getSessions();
      if (mounted) setState(() => _sessions = sessions);
    } catch (_) {
      // Agent reachability is surfaced by the Device screen / plan errors;
      // a stale session list is preferable to flicker here.
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(context.strings.actionFailed(describeAgentError(error))),
      ),
    );
  }

  Future<void> _previewPlan() async {
    final peerId = _peerId;
    final folderId = _folderId;
    if (peerId == null || folderId == null) return;
    setState(() => _loadingPlan = true);
    try {
      final plan = await context.read<ConnectionStore>().api
          .syncPlan(peerId: peerId, folderId: folderId);
      if (mounted) setState(() => _plan = plan);
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _loadingPlan = false);
    }
  }

  Future<void> _runSync() async {
    final peerId = _peerId;
    final folderId = _folderId;
    if (peerId == null || folderId == null) return;
    setState(() => _running = true);
    try {
      final result = await context.read<ConnectionStore>().api
          .syncRun(peerId: peerId, folderId: folderId);
      if (mounted) {
        setState(() => _plan = result.plan);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(context.strings.sessionStarted(result.sessionId)),
          ),
        );
      }
      await _refreshSessions();
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final peersStore = context.watch<PeersStore>();
    final foldersStore = context.watch<FoldersStore>();
    final conflictsStore = context.watch<ConflictsStore>();

    final trustedPeers = peersStore.trustedPeers;
    final folders = foldersStore.folders;

    if (_peerId != null && !trustedPeers.any((p) => p.peerId == _peerId)) {
      _peerId = null;
      _plan = null;
    }
    if (_folderId != null && !folders.any((f) => f.id == _folderId)) {
      _folderId = null;
      _plan = null;
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        if (conflictsStore.openConflicts.isNotEmpty)
          Card(
            margin: const EdgeInsets.only(bottom: 12),
            color: Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              leading: const Icon(Icons.warning_amber_outlined),
              title: Text(strings.conflictsBanner),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const ConflictsScreen(),
                ),
              ),
            ),
          ),
        _pickers(context, trustedPeers, folders, strings),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed:
                    (_peerId != null && _folderId != null && !_loadingPlan && !_running)
                        ? _previewPlan
                        : null,
                icon: const Icon(Icons.difference_outlined),
                label: Text(strings.previewPlan),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: (_peerId != null && _folderId != null && !_running)
                    ? _runSync
                    : null,
                icon: _running
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.sync),
                label: Text(strings.startSync),
              ),
            ),
          ],
        ),
        if (peersStore.state == LoadState.error ||
            foldersStore.state == LoadState.error)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: ErrorView(
              message: peersStore.error ?? foldersStore.error ?? '',
              onRetry: () {
                peersStore.refresh();
                foldersStore.refresh();
              },
            ),
          ),
        if (trustedPeers.isEmpty && peersStore.state == LoadState.loaded) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(strings.needTrustedPeer),
            ),
          ),
        ],
        if (folders.isEmpty && foldersStore.state == LoadState.loaded) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(strings.needFolder),
            ),
          ),
        ],
        if (_loadingPlan) ...[
          const SizedBox(height: 16),
          const Center(child: CircularProgressIndicator()),
        ],
        if (_plan != null) ...[
          const SizedBox(height: 16),
          _planSummary(context, _plan!, strings),
          const SizedBox(height: 8),
          _planActions(context, _plan!, strings),
        ],
        const SizedBox(height: 16),
        Text(strings.recentSessions,
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (_sessions.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(strings.noSessions),
            ),
          )
        else
          ..._sessions.take(10).map((s) => _sessionTile(context, s, strings)),
      ],
    );
  }

  Widget _pickers(
    BuildContext context,
    List<Peer> trustedPeers,
    List<SharedFolder> folders,
    AppStrings strings,
  ) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              strings.peerLabel,
              style: theme.textTheme.labelMedium,
            ),
            DropdownButtonFormField<String>(
              initialValue: _peerId,
              isExpanded: true,
              decoration: InputDecoration(
                hintText: strings.pickPeerPrompt,
              ),
              items: trustedPeers
                  .map((p) => DropdownMenuItem(
                        value: p.peerId,
                        child: Text('${p.name} (${shortPeerId(p.peerId)})'),
                      ))
                  .toList(),
              onChanged: (v) => setState(() {
                _peerId = v;
                _plan = null;
              }),
            ),
            const SizedBox(height: 12),
            Text(strings.folderLabel, style: theme.textTheme.labelMedium),
            DropdownButtonFormField<int>(
              initialValue: _folderId,
              isExpanded: true,
              decoration: InputDecoration(hintText: strings.pickFolderPrompt),
              items: folders
                  .map((f) => DropdownMenuItem(
                        value: f.id,
                        child: Text(f.name),
                      ))
                  .toList(),
              onChanged: (v) => setState(() {
                _folderId = v;
                _plan = null;
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _planSummary(BuildContext context, SyncPlan plan, AppStrings strings) {
    final summary = plan.summary;
    final theme = Theme.of(context);
    final entries = <(String, String)>[
      (strings.total, strings.num(summary.total)),
      (strings.pullLabel, strings.num(summary.pull)),
      (strings.pushLabel, strings.num(summary.push)),
      (strings.deleteLocalLabel, strings.num(summary.deleteLocal)),
      (strings.deleteRemoteLabel, strings.num(summary.deleteRemote)),
      (strings.conflictsLabel, strings.num(summary.conflicts)),
      (strings.unchangedLabel, strings.num(summary.unchanged)),
    ];
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${strings.planSummaryLabel} — ${plan.peerName} / ${plan.folder.name}',
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: entries
                  .map((e) => Chip(
                        label: Text('${e.$2} ${e.$1}'),
                        visualDensity: VisualDensity.compact,
                      ))
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _planActions(BuildContext context, SyncPlan plan, AppStrings strings) {
    final relevant =
        plan.actions.where((a) => a.state != PlanActionState.unchanged).toList();
    final theme = Theme.of(context);
    if (relevant.isEmpty) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Text(strings.allSynced),
        ),
      );
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
            child: Text(
              strings.planActionsLabel,
              style: theme.textTheme.titleSmall,
            ),
          ),
          ...relevant.map((action) {
            final color = _planActionColor(action.state, theme.colorScheme);
            final icon = action.direction == TransferDirection.push
                ? Icons.upload_outlined
                : action.direction == TransferDirection.pull
                    ? Icons.download_outlined
                    : Icons.remove_circle_outline;
            return ListTile(
              dense: true,
              leading: Icon(icon, color: color),
              title: Text(
                action.relPath,
                textDirection: TextDirection.ltr,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                '${planActionLabel(action.state, strings)} • ${formatBytes(action.size)}',
                textDirection: TextDirection.ltr,
              ),
              trailing: Text(
                planActionLabel(action.state, strings),
                style: theme.textTheme.labelSmall?.copyWith(color: color),
              ),
            );
          }),
        ],
      ),
    );
  }

  Color _planActionColor(PlanActionState state, ColorScheme scheme) {
    switch (state) {
      case PlanActionState.conflict:
        return scheme.error;
      case PlanActionState.deleteLocal:
      case PlanActionState.deleteRemote:
        return Colors.deepOrange;
      case PlanActionState.localModified:
      case PlanActionState.localOnly:
      case PlanActionState.remoteOnly:
      case PlanActionState.remoteModified:
        return scheme.primary;
      case PlanActionState.unchanged:
        return scheme.outline;
    }
  }

  Widget _sessionTile(BuildContext context, SyncSession s, AppStrings strings) {
    final theme = Theme.of(context);
    final failed = s.error != null && s.error!.isNotEmpty;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        leading: Icon(
          failed ? Icons.error_outline : Icons.check_circle_outline,
          color: failed ? theme.colorScheme.error : Colors.green.shade600,
        ),
        title: Text(
          '${s.peerName} ↔ ${s.folderName}',
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${s.status} • ${formatBytes(s.transferred)} • '
          '${strings.filesCount(s.filesTransferred)} • '
          '${formatTimestamp(s.startedAt)}',
          textDirection: TextDirection.ltr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: failed
            ? Tooltip(
                message: s.error,
                child: Icon(Icons.info_outline, color: theme.colorScheme.error),
              )
            : null,
      ),
    );
  }
}
