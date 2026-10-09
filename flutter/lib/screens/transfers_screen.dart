/// Transfers screen: live progress, active/all filter, lifecycle actions.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/agent_api.dart';
import '../l10n/context_strings.dart';
import '../models/models.dart';
import '../state/load_state.dart';
import '../state/transfers_store.dart';
import '../widgets/state_views.dart';
import '../widgets/transfer_tile.dart';

class TransfersScreen extends StatefulWidget {
  const TransfersScreen({super.key});

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

enum _TransferFilter { active, all }

class _TransfersScreenState extends State<TransfersScreen> {
  _TransferFilter _filter = _TransferFilter.active;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    context.read<TransfersStore>().refresh();
    _timer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => mounted ? context.read<TransfersStore>().refresh() : null,
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
      SnackBar(
        content: Text(context.strings.actionFailed(describeAgentError(error))),
      ),
    );
  }

  Future<void> _act(Future<Transfer> Function(String id) action, String id) async {
    try {
      await action(id);
    } catch (error) {
      _showError(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    final store = context.watch<TransfersStore>();
    final transfers = _filter == _TransferFilter.active
        ? store.activeTransfers
        : store.transfers;

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
        if (transfers.isEmpty) {
          body = EmptyView(
            title: strings.transfersEmptyTitle,
            hint: _filter == _TransferFilter.active
                ? strings.transfersEmptyHint
                : '',
            icon: Icons.swap_vert,
          );
        } else {
          body = RefreshIndicator(
            onRefresh: () => store.refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 24),
              itemCount: transfers.length,
              itemBuilder: (context, index) {
                final transfer = transfers[index];
                return TransferTile(
                  transfer: transfer,
                  strings: strings,
                  onPause: () => _act(store.pause, transfer.id),
                  onResume: () => _act(store.resume, transfer.id),
                  onCancel: () => _act(store.cancel, transfer.id),
                  onRetry: () => _act(store.retry, transfer.id),
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
          child: SegmentedButton<_TransferFilter>(
            segments: [
              ButtonSegment(
                value: _TransferFilter.active,
                label: Text(strings.activeTransfers),
                icon: const Icon(Icons.bolt_outlined),
              ),
              ButtonSegment(
                value: _TransferFilter.all,
                label: Text(strings.allTransfers),
                icon: const Icon(Icons.list),
              ),
            ],
            selected: {_filter},
            onSelectionChanged: (selection) =>
                setState(() => _filter = selection.first),
          ),
        ),
        Expanded(child: body),
      ],
    );
  }
}
