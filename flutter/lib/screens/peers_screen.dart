/// Peers screen: discovery scan, pairing, trust management.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../state/load_state.dart';
import '../state/peers_store.dart';
import '../widgets/peer_card.dart';
import '../widgets/state_views.dart';

class PeersScreen extends StatefulWidget {
  const PeersScreen({super.key});

  @override
  State<PeersScreen> createState() => _PeersScreenState();
}

class _PeersScreenState extends State<PeersScreen> {
  Timer? _timer;
  bool _scanning = false;

  @override
  void initState() {
    super.initState();
    context.read<PeersStore>().refresh();
    _timer = Timer.periodic(
      const Duration(seconds: 4),
      (_) => mounted ? context.read<PeersStore>().refresh() : null,
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _scan() async {
    if (_scanning) return;
    setState(() => _scanning = true);
    final store = context.read<PeersStore>();
    final strings = context.strings;
    try {
      final found = await store.scan();
      if (!mounted) return;
      final msg =
          found.isEmpty ? strings.noNewPeersFound : strings.newPeersFound(found.length);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _pairDialog() async {
    final strings = context.strings;
    final store = context.read<PeersStore>();
    final address = await showDialog<String>(
      context: context,
      builder: (dialogContext) => const _AddressDialog(),
    );
    if (address == null || address.trim().isEmpty) return;
    if (!mounted) return;
    try {
      await store.pair(address.trim());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${strings.pair}: $address')),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.strings.actionFailed(describeAgentError(error)))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final store = context.watch<PeersStore>();

    Widget body;
    switch (store.state) {
      case LoadState.loading:
        body = LoadingView();
      case LoadState.error:
        body = ErrorView(
          message: store.error ?? '',
          hint: strings.checkAddressHint,
          onRetry: () => store.refresh(),
        );
      case LoadState.idle:
        body = LoadingView();
      case LoadState.loaded:
        if (store.peers.isEmpty) {
          body = EmptyView(
            title: strings.noPeersTitle,
            hint: strings.noPeersHint,
            icon: Icons.people_outline,
          );
        } else {
          body = RefreshIndicator(
            onRefresh: () => store.refresh(),
            child: ListView.builder(
              itemCount: store.peers.length,
              itemBuilder: (context, index) {
                final peer = store.peers[index];
                return PeerCard(
                  peer: peer,
                  strings: strings,
                  onApprove: () => _confirmApprove(peer.peerId, peer.name),
                  onRevoke: () => _confirmRevoke(peer.peerId, peer.name),
                  onRemove: () => _confirmRemove(peer.peerId, peer.name),
                );
              },
            ),
          );
        }
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _scanning ? null : _scan,
                  icon: _scanning
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.wifi_find),
                  label: Text(strings.scanNetwork),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _pairDialog,
                  icon: const Icon(Icons.add_link),
                  label: Text(strings.pair),
                ),
              ),
            ],
          ),
        ),
        Expanded(child: body),
      ],
    );
  }

  Future<void> _confirmApprove(String peerId, String name) async {
    final store = context.read<PeersStore>();
    try {
      await store.approve(peerId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${context.strings.approve}: $name')),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _confirmRevoke(String peerId, String name) async {
    final store = context.read<PeersStore>();
    try {
      await store.revoke(peerId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${context.strings.revoke}: $name')),
        );
      }
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _confirmRemove(String peerId, String name) async {
    final strings = context.strings;
    final store = context.read<PeersStore>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${strings.confirmRemovePeerTitle} $name?'),
        content: Text(strings.confirmRemovePeerBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(strings.no),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(strings.yes),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    try {
      await store.remove(peerId);
    } catch (error) {
      _showError(error);
    }
  }
}

class _AddressDialog extends StatefulWidget {
  const _AddressDialog();

  @override
  State<_AddressDialog> createState() => _AddressDialogState();
}

class _AddressDialogState extends State<_AddressDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    return AlertDialog(
      title: Text(strings.pairNewPeer),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: InputDecoration(
          labelText: strings.peerAddressLabel,
          hintText: strings.peerAddressHint,
        ),
        keyboardType: TextInputType.url,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(strings.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: Text(strings.pair),
        ),
      ],
    );
  }
}
