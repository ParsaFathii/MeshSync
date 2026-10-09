/// Device screen: agent identity, health, live stats, recent events.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/context_strings.dart';
import '../models/models.dart';
import '../state/connection_store.dart';
import '../state/events_store.dart';
import '../state/load_state.dart';
import '../util/format.dart';
import '../widgets/stat_tile.dart';
import '../widgets/state_views.dart';

class DeviceScreen extends StatefulWidget {
  const DeviceScreen({super.key});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _tick());
  }

  void _tick() {
    if (!mounted) return;
    context.read<ConnectionStore>().checkNow();
    context.read<EventsStore>().refresh();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final connection = context.watch<ConnectionStore>();
    final events = context.watch<EventsStore>();

    if (connection.connecting && connection.health == null) {
      return LoadingView(label: strings.connecting);
    }
    if (!connection.online) {
      return ErrorView(
        message: connection.lastError ?? strings.offline,
        hint: strings.checkAddressHint,
        onRetry: () => _tick(),
      );
    }

    final device = connection.deviceInfo;
    final health = connection.health;
    final stats = device?.stats;

    return RefreshIndicator(
      onRefresh: () {
        final connection = context.read<ConnectionStore>();
        final events = context.read<EventsStore>();
        return Future.wait([
          connection.checkNow(),
          events.refresh(),
        ]);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
        children: [
          _identityCard(context, device, health),
          const SizedBox(height: 12),
          Text(strings.stats, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (stats != null) _statsGrid(context, stats),
          const SizedBox(height: 12),
          Text(
            strings.recentActivity,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          _activityList(context, events),
        ],
      ),
    );
  }

  Widget _identityCard(BuildContext context, DeviceInfo? device, Health? health) {
    final theme = Theme.of(context);
    final strings = context.strings;

    Widget row(String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 130,
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
              Expanded(
                child: Text(
                  value,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontWeight: FontWeight.w600),
                  textDirection: TextDirection.ltr,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        );

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    strings.thisDevice,
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (health != null) ...[
                  Icon(
                    health.dbOk ? Icons.check_circle : Icons.error,
                    size: 18,
                    color: health.dbOk
                        ? Colors.green.shade600
                        : theme.colorScheme.error,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${strings.dbOkLabel}: '
                    '${health.dbOk ? strings.dbHealthy : strings.dbUnhealthy}',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            row(
              strings.deviceNameLabel,
              device?.name ?? strings.notAvailable,
            ),
            row(strings.peerIdLabel, device?.peerId ?? '—'),
            row(strings.version, device?.version ?? health?.version ?? '—'),
            row(strings.platform, device?.platform ?? '—'),
            row(strings.startedAt, formatTimestamp(device?.startedAt)),
            row(
              strings.uptime,
              health == null ? '—' : formatUptime(health.uptimeSeconds),
            ),
            row(strings.apiPort, '${device?.apiPort ?? '—'}'),
            row(strings.peerPort, '${device?.peerPort ?? '—'}'),
            row(strings.keyFingerprint, device?.keyFingerprint ?? '—'),
            row(strings.nativeEngine, device?.nativeEngine ?? '—'),
          ],
        ),
      ),
    );
  }

  Widget _statsGrid(BuildContext context, DeviceStats stats) {
    final strings = context.strings;
    return GridView.count(
      crossAxisCount: MediaQuery.of(context).size.width > 600 ? 4 : 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.9,
      children: [
        StatTile(
          label: strings.foldersStat,
          value: strings.num(stats.folders),
          icon: Icons.folder_outlined,
        ),
        StatTile(
          label: strings.filesIndexedStat,
          value: strings.num(stats.filesIndexed),
          icon: Icons.description_outlined,
        ),
        StatTile(
          label: strings.bytesIndexedStat,
          value: formatBytes(stats.bytesIndexed),
          icon: Icons.sd_storage_outlined,
        ),
        StatTile(
          label: strings.peersTrustedStat,
          value: '${strings.num(stats.peersOnline)}/${strings.num(stats.peersTrusted)}',
          sublabel: strings.peersOnlineStat,
          icon: Icons.people_outline,
        ),
        StatTile(
          label: strings.transfersActiveStat,
          value: strings.num(stats.transfersActive),
          icon: Icons.swap_vert,
        ),
        StatTile(
          label: strings.transfersCompletedStat,
          value: strings.num(stats.transfersCompleted),
          icon: Icons.task_outlined,
        ),
        StatTile(
          label: strings.conflictsOpenStat,
          value: strings.num(stats.conflictsOpen),
          icon: Icons.warning_amber_outlined,
        ),
        StatTile(
          label: strings.lastSyncAt,
          value: stats.lastSyncAt == null
              ? strings.never
              : formatTimestamp(stats.lastSyncAt),
          icon: Icons.sync,
        ),
      ],
    );
  }

  Widget _activityList(BuildContext context, EventsStore events) {
    final strings = context.strings;
    if (events.events.isEmpty && events.state == LoadState.loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: CircularProgressIndicator(),
        ),
      );
    }
    final recent = events.latest.take(8).toList();
    if (recent.isEmpty) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Text(strings.noEventsYet),
        ),
      );
    }
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        children: recent.map((event) {
          final icon = switch (event.severity) {
            EventSeverity.error => Icons.error_outline,
            EventSeverity.warn => Icons.warning_amber_outlined,
            EventSeverity.info => Icons.info_outline,
          };
          final color = switch (event.severity) {
            EventSeverity.error => theme.colorScheme.error,
            EventSeverity.warn => Colors.amber.shade700,
            EventSeverity.info => theme.colorScheme.primary,
          };
          return ListTile(
            dense: true,
            leading: Icon(icon, size: 20, color: color),
            title: Text(
              event.message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Text(
              '${formatTimestamp(event.ts)} • ${event.type}',
              textDirection: TextDirection.ltr,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          );
        }).toList(),
      ),
    );
  }
}
