/// MeshSync mobile client — entry point.
///
/// Wires the stores to the agent API (provider DI), starts health polling
/// and the WebSocket live service, and builds the localized Material app
/// (fa primary, en secondary, RTL-aware, dark-capable).
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/shell_screen.dart';
import 'state/app_settings.dart';
import 'state/conflicts_store.dart';
import 'state/connection_store.dart';
import 'state/events_store.dart';
import 'state/files_store.dart';
import 'state/folders_store.dart';
import 'state/live_service.dart';
import 'state/peers_store.dart';
import 'state/transfers_store.dart';

void main() {
  runApp(const MeshSyncApp());
}

class MeshSyncApp extends StatefulWidget {
  const MeshSyncApp({super.key});

  @override
  State<MeshSyncApp> createState() => _MeshSyncAppState();
}

class _MeshSyncAppState extends State<MeshSyncApp> {
  late final AppSettings _settings;
  late final ConnectionStore _connection;
  late final PeersStore _peers;
  late final FoldersStore _folders;
  late final FilesStore _files;
  late final TransfersStore _transfers;
  late final ConflictsStore _conflicts;
  late final EventsStore _events;
  late final LiveService _live;

  @override
  void initState() {
    super.initState();
    _settings = AppSettings();
    _connection = ConnectionStore(settings: _settings);
    _peers = PeersStore(api: () => _connection.api);
    _folders = FoldersStore(api: () => _connection.api);
    _files = FilesStore(api: () => _connection.api);
    _transfers = TransfersStore(api: () => _connection.api);
    _conflicts = ConflictsStore(api: () => _connection.api);
    _events = EventsStore(api: () => _connection.api);
    _live = LiveService(
      connection: _connection,
      peers: _peers,
      folders: _folders,
      transfers: _transfers,
      conflicts: _conflicts,
      events: _events,
    );
    _settings.load();
    _connection.start();
    _live.start();
  }

  @override
  void dispose() {
    _live.dispose();
    _connection.dispose();
    _peers.dispose();
    _folders.dispose();
    _files.dispose();
    _transfers.dispose();
    _conflicts.dispose();
    _events.dispose();
    _settings.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppSettings>.value(value: _settings),
        ChangeNotifierProvider<ConnectionStore>.value(value: _connection),
        ChangeNotifierProvider<PeersStore>.value(value: _peers),
        ChangeNotifierProvider<FoldersStore>.value(value: _folders),
        ChangeNotifierProvider<FilesStore>.value(value: _files),
        ChangeNotifierProvider<TransfersStore>.value(value: _transfers),
        ChangeNotifierProvider<ConflictsStore>.value(value: _conflicts),
        ChangeNotifierProvider<EventsStore>.value(value: _events),
      ],
      child: AnimatedBuilder(
        animation: _settings,
        builder: (context, _) => MaterialApp(
          title: 'MeshSync',
          debugShowCheckedModeBanner: false,
          theme: _lightTheme(),
          darkTheme: _darkTheme(),
          themeMode: switch (_settings.themeMode) {
            'light' => ThemeMode.light,
            'dark' => ThemeMode.dark,
            _ => ThemeMode.system,
          },
          builder: (context, child) => Directionality(
            textDirection:
                _settings.isRtl ? TextDirection.rtl : TextDirection.ltr,
            child: child!,
          ),
          home: const ShellScreen(),
        ),
      ),
    );
  }

  static ThemeData _lightTheme() {
    const seed = Color(0xFF00695C);
    final scheme = ColorScheme.fromSeed(seedColor: seed);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
    );
  }

  static ThemeData _darkTheme() {
    const seed = Color(0xFF00695C);
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
    );
  }
}
