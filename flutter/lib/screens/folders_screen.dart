/// Shared folders screen: add / rescan / remove, then browse files.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../models/models.dart';
import '../state/folders_store.dart';
import '../state/load_state.dart';
import '../util/format.dart';
import 'files_browser_screen.dart';
import '../widgets/state_views.dart';

class SharedFoldersScreen extends StatefulWidget {
  const SharedFoldersScreen({super.key});

  @override
  State<SharedFoldersScreen> createState() => _SharedFoldersScreenState();
}

class _SharedFoldersScreenState extends State<SharedFoldersScreen> {
  @override
  void initState() {
    super.initState();
    context.read<FoldersStore>().refresh();
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(context.strings.actionFailed(describeAgentError(error))),
      ),
    );
  }

  Future<void> _addFolder() async {
    final strings = context.strings;
    final store = context.read<FoldersStore>();
    final result = await showDialog<({String name, String path})>(
      context: context,
      builder: (dialogContext) => const _AddFolderDialog(),
    );
    if (result == null) return;
    if (!mounted) return;
    try {
      await store.add(name: result.name, path: result.path);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${strings.addFolder}: ${result.name}')),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _rescan(int folderId) async {
    final strings = context.strings;
    try {
      final result = await context.read<FoldersStore>().rescan(folderId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              strings.rescanResult(result.scanned, result.changed, result.removed),
            ),
          ),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _remove(SharedFolder folder) async {
    final strings = context.strings;
    var deleteFiles = false;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text('${strings.removeFolder}: ${folder.name}?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(strings.confirmRemoveFolderBody),
              CheckboxListTile(
                value: deleteFiles,
                onChanged: (v) =>
                    setDialogState(() => deleteFiles = v ?? false),
                title: Text(strings.deleteFilesToo),
                controlAffinity: ListTileControlAffinity.leading,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(strings.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(strings.deleteBtn),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    final store = context.read<FoldersStore>();
    try {
      await store.remove(folder.id, deleteFiles: deleteFiles);
    } catch (error) {
      _showError(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final store = context.watch<FoldersStore>();

    Widget body;
    switch (store.state) {
      case LoadState.idle:
      case LoadState.loading:
        body = const LoadingView();
      case LoadState.error:
        body = ErrorView(
          message: store.error ?? '',
          hint: strings.checkAddressHint,
          onRetry: () => store.refresh(),
        );
      case LoadState.loaded:
        if (store.folders.isEmpty) {
          body = EmptyView(
            title: strings.noFoldersTitle,
            hint: strings.noFoldersHint,
            icon: Icons.folder_off_outlined,
          );
        } else {
          body = RefreshIndicator(
            onRefresh: () => store.refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
              itemCount: store.folders.length,
              itemBuilder: (context, index) =>
                  _folderTile(context, store.folders[index]),
            ),
          );
        }
    }

    return Stack(
      children: [
        body,
        Positioned(
          left: 16,
          right: 16,
          bottom: 16,
          child: FilledButton.icon(
            onPressed: _addFolder,
            icon: const Icon(Icons.create_new_folder_outlined),
            label: Text(strings.addFolder),
          ),
        ),
      ],
    );
  }

  Widget _folderTile(BuildContext context, SharedFolder folder) {
    final theme = Theme.of(context);
    final strings = context.strings;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => FilesBrowserScreen(folder: folder),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
          child: Row(
            children: [
              const Icon(Icons.folder_shared_outlined),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      folder.name,
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      folder.path,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${strings.filesCount(folder.fileCount)} • '
                      '${formatBytes(folder.totalBytes)} • '
                      '${strings.lastScanLabel}: ${formatTimestamp(folder.lastScanAt)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              PopupMenuButton<String>(
                onSelected: (action) {
                  if (action == 'rescan') _rescan(folder.id);
                  if (action == 'remove') _remove(folder);
                },
                itemBuilder: (context) => [
                  PopupMenuItem(
                    value: 'rescan',
                    child: Text(strings.rescan),
                  ),
                  PopupMenuItem(
                    value: 'remove',
                    child: Text(strings.removeFolder),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddFolderDialog extends StatefulWidget {
  const _AddFolderDialog();

  @override
  State<_AddFolderDialog> createState() => _AddFolderDialogState();
}

class _AddFolderDialogState extends State<_AddFolderDialog> {
  final _name = TextEditingController();
  final _path = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _path.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    return AlertDialog(
      title: Text(strings.addFolder),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _name,
            autofocus: true,
            decoration: InputDecoration(
              labelText: strings.folderNameLabel,
              hintText: strings.folderNameHint,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _path,
            decoration: InputDecoration(
              labelText: strings.folderPathLabel,
              hintText: strings.folderPathHint,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(strings.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(
            (name: _name.text.trim(), path: _path.text.trim()),
          ),
          child: Text(strings.addFolder),
        ),
      ],
    );
  }
}
