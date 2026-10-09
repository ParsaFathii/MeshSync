/// Adaptive navigation shell: bottom NavigationBar on phones (5 tabs,
/// conflicts + settings via the app bar), NavigationRail with all 7
/// destinations on wide layouts.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/context_strings.dart';
import '../l10n/strings.dart';
import '../state/conflicts_store.dart';
import 'conflicts_screen.dart';
import 'device_screen.dart';
import 'folders_screen.dart';
import 'peers_screen.dart';
import 'settings_screen.dart';
import 'sync_screen.dart';
import 'transfers_screen.dart';

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _index = 0;
  Timer? _conflictsTimer;

  static const List<Widget> _screens = <Widget>[
    DeviceScreen(),
    PeersScreen(),
    SharedFoldersScreen(),
    SyncScreen(),
    TransfersScreen(),
    ConflictsScreen(),
    SettingsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    context.read<ConflictsStore>().refresh();
    // Slow badge refresh; screens poll faster while visible and WS frames
    // trigger immediate refreshes on conflict events.
    _conflictsTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => mounted ? context.read<ConflictsStore>().refresh() : null,
    );
  }

  @override
  void dispose() {
    _conflictsTimer?.cancel();
    super.dispose();
  }

  void _openConflicts() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ConflictsScreen()),
    );
  }

  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.of(context).size.width >= 800;
    if (wide) {
      return _wideLayout(context);
    }
    return _narrowLayout(context);
  }

  String _title(int index, AppStrings strings) {
    switch (index) {
      case 0:
        return strings.tabDevice;
      case 1:
        return strings.tabPeers;
      case 2:
        return strings.tabFolders;
      case 3:
        return strings.tabSync;
      case 4:
        return strings.tabTransfers;
      case 5:
        return strings.conflictsTitle;
      case 6:
        return strings.settingsTitle;
    }
    return strings.appTitle;
  }

  Widget _conflictsAction(BuildContext context) {
    final openCount = context.watch<ConflictsStore>().openConflicts.length;
    return IconButton(
      tooltip: context.strings.conflictsTitle,
      onPressed: _openConflicts,
      icon: Badge(
        isLabelVisible: openCount > 0,
        label: Text(context.strings.num(openCount)),
        child: const Icon(Icons.merge_outlined),
      ),
    );
  }

  Widget _narrowLayout(BuildContext context) {
    final strings = context.strings;
    return Scaffold(
      appBar: AppBar(
        title: Text(_title(_index.clamp(0, 4), strings)),
        actions: [
          _conflictsAction(context),
          IconButton(
            tooltip: strings.settingsTitle,
            onPressed: _openSettings,
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: IndexedStack(
        index: _index.clamp(0, 4),
        children: const [
          DeviceScreen(),
          PeersScreen(),
          SharedFoldersScreen(),
          SyncScreen(),
          TransfersScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index.clamp(0, 4),
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.dns_outlined),
            selectedIcon: const Icon(Icons.dns),
            label: strings.tabDevice,
          ),
          NavigationDestination(
            icon: const Icon(Icons.people_outline),
            selectedIcon: const Icon(Icons.people),
            label: strings.tabPeers,
          ),
          NavigationDestination(
            icon: const Icon(Icons.folder_outlined),
            selectedIcon: const Icon(Icons.folder),
            label: strings.tabFolders,
          ),
          NavigationDestination(
            icon: const Icon(Icons.sync_outlined),
            selectedIcon: const Icon(Icons.sync),
            label: strings.tabSync,
          ),
          NavigationDestination(
            icon: const Icon(Icons.swap_vert_outlined),
            selectedIcon: const Icon(Icons.swap_vert),
            label: strings.tabTransfers,
          ),
        ],
      ),
    );
  }

  Widget _wideLayout(BuildContext context) {
    final strings = context.strings;
    return Scaffold(
      appBar: AppBar(
        title: Text(_title(_index, strings)),
      ),
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() => _index = i),
            labelType: NavigationRailLabelType.all,
            groupAlignment: -1,
            destinations: [
              NavigationRailDestination(
                icon: const Icon(Icons.dns_outlined),
                selectedIcon: const Icon(Icons.dns),
                label: Text(strings.tabDevice),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.people_outline),
                selectedIcon: const Icon(Icons.people),
                label: Text(strings.tabPeers),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.folder_outlined),
                selectedIcon: const Icon(Icons.folder),
                label: Text(strings.tabFolders),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.sync_outlined),
                selectedIcon: const Icon(Icons.sync),
                label: Text(strings.tabSync),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.swap_vert_outlined),
                selectedIcon: const Icon(Icons.swap_vert),
                label: Text(strings.tabTransfers),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.merge_outlined),
                selectedIcon: const Icon(Icons.merge),
                label: Text(strings.conflictsTitle),
              ),
              NavigationRailDestination(
                icon: const Icon(Icons.settings_outlined),
                selectedIcon: const Icon(Icons.settings),
                label: Text(strings.settingsTitle),
              ),
            ],
          ),
          const VerticalDivider(thickness: 1, width: 1),
          Expanded(
            child: IndexedStack(index: _index, children: _screens),
          ),
        ],
      ),
    );
  }
}
