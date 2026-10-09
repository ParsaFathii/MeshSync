/// Event feed: REST polling with `sinceEventId` + WS `event` frames,
/// newest last, capped at [maxEvents]. Screens own polling timers.
library;

import 'package:flutter/foundation.dart';

import '../api/agent_api.dart';
import '../models/models.dart';
import 'load_state.dart';

class EventsStore extends ChangeNotifier {
  EventsStore({required AgentApi Function() api, this.maxEvents = 200})
      : _apiProvider = api,
        _api = api();

  final AgentApi Function() _apiProvider;
  AgentApi _api;
  final int maxEvents;

  /// Ascending by id (newest last), as delivered by the agent.
  List<AgentEvent> events = const <AgentEvent>[];
  LoadState state = LoadState.idle;
  String? error;
  bool _busy = false;

  AgentApi get _currentApi {
    final next = _apiProvider();
    if (!identical(next, _api)) {
      _api = next;
    }
    return _api;
  }

  int? get _lastEventId => events.isEmpty ? null : events.last.id;

  /// Newest-first view for compact activity feeds.
  List<AgentEvent> get latest => events.reversed.toList();

  /// Fetches only events newer than the last seen id (first load: limit 100).
  Future<void> refresh() async {
    if (_busy) return;
    _busy = true;
    if (state != LoadState.loaded && events.isEmpty) {
      state = LoadState.loading;
      notifyListeners();
    }
    try {
      final fresh = await _currentApi.getEvents(
        sinceEventId: _lastEventId,
        limit: _lastEventId == null ? 100 : null,
      );
      _appendAll(fresh);
      state = LoadState.loaded;
      error = null;
      notifyListeners();
    } catch (err) {
      if (events.isEmpty) {
        state = LoadState.error;
      }
      error = describeAgentError(err);
      notifyListeners();
    } finally {
      _busy = false;
    }
  }

  /// Applies a WS `event` frame (deduped by id).
  void append(AgentEvent event) {
    if (events.any((e) => e.id == event.id)) return;
    events = List<AgentEvent>.of(events)..add(event);
    _trim();
    if (state != LoadState.loaded) {
      state = LoadState.loaded;
      error = null;
    }
    notifyListeners();
  }

  void _appendAll(List<AgentEvent> fresh) {
    if (fresh.isEmpty) return;
    final known = events.map((e) => e.id).toSet();
    final newOnes = fresh.where((e) => !known.contains(e.id)).toList()
      ..sort((a, b) => a.id.compareTo(b.id));
    if (newOnes.isEmpty) return;
    events = List<AgentEvent>.of(events)..addAll(newOnes);
    _trim();
  }

  void _trim() {
    if (events.length > maxEvents) {
      events = events.sublist(events.length - maxEvents);
    }
  }
}
