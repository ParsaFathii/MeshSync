/// File browser for one shared folder: directory navigation with
/// breadcrumbs, sync-state badges, file details (chunks + peer copies),
/// create / delete / download actions — all against the real agent API.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../models/models.dart';
import '../state/files_store.dart';
import '../state/load_state.dart';
import '../util/format.dart';
import '../widgets/file_list_tile.dart';
import '../widgets/state_views.dart';

class FilesBrowserScreen extends StatefulWidget {
  const FilesBrowserScreen({super.key, required this.folder});

  final SharedFolder folder;

  @override
  State<FilesBrowserScreen> createState() => _FilesBrowserScreenState();
}

class _FilesBrowserScreenState extends State<FilesBrowserScreen> {
  @override
  void initState() {
    super.initState();
    context.read<FilesStore>().openFolder(widget.folder);
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(context.strings.actionFailed(describeAgentError(error))),
      ),
    );
  }

  List<String> _pathSegments(String path) =>
      path.isEmpty ? <String>[] : path.split('/').where((s) => s.isNotEmpty).toList();

  Future<void> _jumpTo(String targetPath) async {
    final store = context.read<FilesStore>();
    store.path = targetPath;
    await store.refresh();
  }

  Future<void> _openDetail(FileEntry entry) async {
    final store = context.read<FilesStore>();
    try {
      final detail = await store.fetchFileDetail(entry);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (sheetContext) => _FileDetailSheet(
          detail: detail,
          onDelete: () => _confirmDelete(entry),
          onDownload: () => _download(entry),
        ),
      );
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _confirmDelete(FileEntry entry) async {
    final strings = context.strings;
    final store = context.read<FilesStore>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${strings.deleteFileTitle} ${entry.name}'),
        content: Text(strings.deleteFileBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(strings.no),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(strings.deleteBtn),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    try {
      await store.deleteFile(entry);
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _download(FileEntry entry) async {
    final store = context.read<FilesStore>();
    final strings = context.strings;
    try {
      final bytes = await store.downloadFile(entry);
      final target = File(
        '${Directory.systemTemp.path}/meshsync-${entry.name}',
      );
      await target.writeAsBytes(bytes, flush: true);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(strings.downloadedTo(target.path)),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _newFile() async {
    final store = context.read<FilesStore>();
    final result =
        await showDialog<({String name, String content})?>(
      context: context,
      builder: (dialogContext) => const _NewFileDialog(),
    );
    if (result == null) return;
    if (!mounted) return;
    try {
      await store.createTextFile(result.name, result.content);
    } catch (error) {
      _showError(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final store = context.watch<FilesStore>();
    final segments = _pathSegments(store.path);

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
        final entries = store.listing?.entries ?? const <FileEntry>[];
        if (entries.isEmpty) {
          body = EmptyView(
            title: strings.emptyDir,
            hint: '',
            icon: Icons.folder_open,
          );
        } else {
          body = RefreshIndicator(
            onRefresh: () => store.refresh(),
            child: ListView.builder(
              itemCount: entries.length,
              itemBuilder: (context, index) {
                final entry = entries[index];
                return FileListTile(
                  entry: entry,
                  strings: strings,
                  onTap: () =>
                      entry.isDir ? store.navigate(entry.name) : _openDetail(entry),
                );
              },
            ),
          );
        }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.folder.name),
        actions: [
          IconButton(
            tooltip: strings.upLevel,
            onPressed: store.path.isEmpty ? null : () => store.goUp(),
            icon: const Icon(Icons.arrow_upward),
          ),
          IconButton(
            tooltip: strings.newFile,
            onPressed: _newFile,
            icon: const Icon(Icons.note_add_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          _breadcrumbs(context, segments, store),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _breadcrumbs(
    BuildContext context,
    List<String> segments,
    FilesStore store,
  ) {
    if (segments.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          for (var i = 0; i < segments.length; i++) ...[
            if (i > 0)
              const Icon(Icons.chevron_right, size: 18)
            else
              const Icon(Icons.home_outlined, size: 18),
            ActionChip(
              label: Text(
                segments[i],
                textDirection: TextDirection.ltr,
              ),
              onPressed: () => _jumpTo(
                segments.sublist(0, i + 1).join('/'),
              ),
            ),
          ],
          IconButton(
            tooltip: context.strings.upLevel,
            icon: const Icon(Icons.subdirectory_arrow_left),
            onPressed: () => store.goUp(),
          ),
        ],
      ),
    );
  }
}

class _FileDetailSheet extends StatelessWidget {
  const _FileDetailSheet({
    required this.detail,
    required this.onDelete,
    required this.onDownload,
  });

  final FileDetail detail;
  final VoidCallback onDelete;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final theme = Theme.of(context);
    final doneChunks = detail.chunks
        .where((c) => c.state == ChunkState.done)
        .length;

    Padding row(String label, String value) => Padding(
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
                ),
              ),
            ],
          ),
        );

    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(strings.details, style: theme.textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              detail.path,
              textDirection: TextDirection.ltr,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            row(strings.sizeLabel, formatBytes(detail.size)),
            row(strings.modifiedLabel, formatTimestamp(detail.mtime)),
            row('SHA-256', shortHash(detail.hash)),
            row(strings.lastSyncedHashLabel, shortHash(detail.lastSyncedHash)),
            row(
              strings.syncStateLabel,
              fileSyncStateLabel(detail.syncState, strings),
            ),
            if (detail.chunks.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                '${strings.chunksLabel}: ${strings.num(doneChunks)}/${strings.num(detail.chunks.length)}',
                style: theme.textTheme.bodyMedium,
                textDirection: TextDirection.ltr,
              ),
            ],
            if (detail.peers.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(strings.peerCopiesLabel, style: theme.textTheme.titleSmall),
              for (final entry in detail.peers.entries)
                row(
                  shortPeerId(entry.key),
                  '${formatBytes(entry.value.size)} • '
                  '${formatTimestamp(entry.value.mtime)} • '
                  '${shortHash(entry.value.hash)}',
                ),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onDownload,
                    icon: const Icon(Icons.download_outlined),
                    label: Text(strings.download),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: onDelete,
                    icon: const Icon(Icons.delete_outline),
                    label: Text(strings.deleteBtn),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _NewFileDialog extends StatefulWidget {
  const _NewFileDialog();

  @override
  State<_NewFileDialog> createState() => _NewFileDialogState();
}

class _NewFileDialogState extends State<_NewFileDialog> {
  final _name = TextEditingController();
  final _content = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _content.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    return AlertDialog(
      title: Text(strings.newFile),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _name,
            autofocus: true,
            decoration: InputDecoration(
              labelText: strings.fileNameLabel,
              hintText: 'notes.txt',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _content,
            maxLines: 5,
            decoration: InputDecoration(
              labelText: strings.fileContentLabel,
              alignLabelWithHint: true,
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
            (name: _name.text.trim(), content: _content.text),
          ),
          child: Text(strings.create),
        ),
      ],
    );
  }
}
