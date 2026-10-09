/// Settings screen: app settings (agent address, language, theme) and
/// agent settings (GET/PUT /api/v1/settings), plus the about card.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../models/models.dart';
import '../state/app_settings.dart';
import '../state/connection_store.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _host;
  late final TextEditingController _port;

  final _agentDeviceName = TextEditingController();
  final _agentBandwidth = TextEditingController();
  final _agentConcurrent = TextEditingController();
  final _agentChunkSize = TextEditingController();
  final _agentAutoSync = TextEditingController();
  bool _agentDiscovery = true;
  bool _agentSkipHidden = false;
  bool _agentLoading = true;
  bool _agentSaving = false;
  String? _agentLoadError;

  @override
  void initState() {
    super.initState();
    final settings = context.read<AppSettings>();
    _host = TextEditingController(text: settings.host);
    _port = TextEditingController(text: '${settings.apiPort}');
    _loadAgentSettings();
  }

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    _agentDeviceName.dispose();
    _agentBandwidth.dispose();
    _agentConcurrent.dispose();
    _agentChunkSize.dispose();
    _agentAutoSync.dispose();
    super.dispose();
  }

  Future<void> _loadAgentSettings() async {
    setState(() => _agentLoading = true);
    try {
      final agentSettings =
          await context.read<ConnectionStore>().api.getSettings();
      if (!mounted) return;
      _agentDeviceName.text = agentSettings.deviceName;
      _agentBandwidth.text = '${agentSettings.bandwidthLimitBps}';
      _agentConcurrent.text = '${agentSettings.concurrentTransfers}';
      _agentChunkSize.text = '${agentSettings.chunkSizeBytes}';
      _agentAutoSync.text = '${agentSettings.autoSyncSeconds}';
      _agentDiscovery = agentSettings.discoveryEnabled;
      _agentSkipHidden = agentSettings.skipHiddenFiles;
      setState(() {
        _agentLoading = false;
        _agentLoadError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _agentLoading = false;
        _agentLoadError = describeAgentError(error);
      });
    }
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  void _applyConnection() {
    final strings = context.strings;
    final host = _host.text.trim();
    final port = int.tryParse(_port.text.trim());
    if (host.isEmpty) {
      _showSnack(strings.hostRequired);
      return;
    }
    if (port == null || port < 1 || port > 65535) {
      _showSnack(strings.invalidPort);
      return;
    }
    context.read<AppSettings>().updateConnection(host: host, apiPort: port);
    _showSnack(strings.savedMsg);
  }

  Future<void> _saveAgentSettings() async {
    final strings = context.strings;
    int? parseField(TextEditingController controller) =>
        int.tryParse(controller.text.trim());
    final bandwidth = parseField(_agentBandwidth);
    final concurrent = parseField(_agentConcurrent);
    final chunkSize = parseField(_agentChunkSize);
    final autoSync = parseField(_agentAutoSync);
    if (bandwidth == null ||
        concurrent == null ||
        chunkSize == null ||
        autoSync == null) {
      _showSnack(strings.invalidNumber);
      return;
    }
    setState(() => _agentSaving = true);
    try {
      await context.read<ConnectionStore>().api.putSettings(
            AgentSettings(
              deviceName: _agentDeviceName.text.trim(),
              bandwidthLimitBps: bandwidth,
              concurrentTransfers: concurrent,
              chunkSizeBytes: chunkSize,
              discoveryEnabled: _agentDiscovery,
              skipHiddenFiles: _agentSkipHidden,
              autoSyncSeconds: autoSync,
            ),
          );
      _showSnack(strings.savedMsg);
    } catch (error) {
      _showSnack(strings.actionFailed(describeAgentError(error)));
    } finally {
      if (mounted) setState(() => _agentSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final settings = context.watch<AppSettings>();
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 32),
      children: [
        // --- App: language + theme ------------------------------------
        Text(strings.appSection, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(strings.languageLabel),
                const SizedBox(height: 4),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'fa', label: Text(strings.persian)),
                    ButtonSegment(value: 'en', label: Text(strings.english)),
                  ],
                  selected: {settings.language},
                  onSelectionChanged: (selection) =>
                      settings.setLanguage(selection.first),
                ),
                const SizedBox(height: 12),
                Text(strings.themeLabel),
                const SizedBox(height: 4),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(
                        value: 'system', label: Text(strings.themeSystem)),
                    ButtonSegment(value: 'light', label: Text(strings.themeLight)),
                    ButtonSegment(value: 'dark', label: Text(strings.themeDark)),
                  ],
                  selected: {settings.themeMode},
                  onSelectionChanged: (selection) =>
                      settings.setThemeMode(selection.first),
                ),
              ],
            ),
          ),
        ),

        // --- App: agent connection ------------------------------------
        const SizedBox(height: 16),
        Text(strings.connectionSection, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _host,
                  decoration: InputDecoration(
                    labelText: strings.hostLabel,
                    hintText: strings.hostHint,
                  ),
                  keyboardType: TextInputType.url,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _port,
                  decoration: InputDecoration(
                    labelText: strings.portLabel,
                    hintText: '3040',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _applyConnection,
                    icon: const Icon(Icons.lan_outlined),
                    label: Text(strings.applyAndReconnect),
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
          child: Row(
            children: [
              Icon(Icons.info_outline,
                  size: 16, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  strings.directConnectionNote,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ),

        // --- Agent settings -------------------------------------------
        const SizedBox(height: 16),
        Text(strings.agentSection, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        if (_agentLoading)
          const Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          )
        else if (_agentLoadError != null)
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(strings.agentSettingsLoadFailed),
                  const SizedBox(height: 4),
                  Text(
                    _agentLoadError!,
                    textDirection: TextDirection.ltr,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _loadAgentSettings,
                    child: Text(strings.retry),
                  ),
                ],
              ),
            ),
          )
        else
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _agentDeviceName,
                    decoration: InputDecoration(
                      labelText: strings.deviceNameLabel,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _agentBandwidth,
                    decoration: InputDecoration(
                      labelText: strings.bandwidthLimitLabel,
                      helperText: strings.unlimitedHint,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _agentConcurrent,
                    decoration: InputDecoration(
                      labelText: strings.concurrentTransfersLabel,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _agentChunkSize,
                    decoration: InputDecoration(
                      labelText: strings.chunkSizeLabel,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _agentAutoSync,
                    decoration: InputDecoration(
                      labelText: strings.autoSyncSecondsLabel,
                      helperText: strings.manualSyncHint,
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  SwitchListTile(
                    value: _agentDiscovery,
                    onChanged: (v) => setState(() => _agentDiscovery = v),
                    title: Text(strings.discoveryEnabledLabel),
                  ),
                  SwitchListTile(
                    value: _agentSkipHidden,
                    onChanged: (v) => setState(() => _agentSkipHidden = v),
                    title: Text(strings.skipHiddenFilesLabel),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _agentSaving ? null : _saveAgentSettings,
                      icon: _agentSaving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(strings.saveAgentSettings),
                    ),
                  ),
                ],
              ),
            ),
          ),

        // --- About ------------------------------------------------------
        const SizedBox(height: 16),
        Text(strings.aboutSection, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.apps_outlined),
                  title: Text(strings.clientVersionLabel),
                  trailing: const Text('0.3.0'),
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.api_outlined),
                  title: Text(strings.apiContractLabel),
                  trailing: const Text('v1'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
