// Package events provides the agent-wide event bus. Events are persisted to
// the local database, delivered to live WebSocket subscribers, and used by
// the UI activity feed. Progress-heavy events are throttled so a fast
// transfer cannot flood the stream.
package events

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/ParsaFathii/MeshSync/agent/internal/store"
)

type Bus struct {
	mu   sync.RWMutex
	subs map[chan Event]bool
	db   *store.DB

	// throttling state per (type + subject key)
	lastMu sync.Mutex
	last   map[string]time.Time
}

type Event struct {
	ID       int64          `json:"id"`
	Type     string         `json:"type"`
	Severity string         `json:"severity"`
	Message  string         `json:"message"`
	Data     map[string]any `json:"data,omitempty"`
	TS       time.Time      `json:"ts"`
}

func NewBus(db *store.DB) *Bus {
	return &Bus{
		subs: map[chan Event]bool{},
		db:   db,
		last: map[string]time.Time{},
	}
}

// Emit persists the event (when db is set) and broadcasts it to all
// subscribers. It never blocks: slow subscribers buffer on their channels
// and get dropped when full.
func (b *Bus) Emit(typ, severity, message string, data map[string]any) {
	e := Event{
		Type:     typ,
		Severity: severity,
		Message:  message,
		Data:     data,
		TS:       time.Now().UTC(),
	}
	if b.db != nil {
		var dataJSON string
		if data != nil {
			if raw, err := json.Marshal(data); err == nil {
				dataJSON = string(raw)
			}
		}
		e.ID, _ = b.db.AddEvent(store.Event{
			Type: typ, Severity: severity, Message: message,
			Data: dataJSON, TS: e.TS.Unix(),
		})
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default: // drop for slow subscriber
		}
	}
}

// ThrottledEmit emits only when the same key has not been emitted within
// the given minimum interval. Used for TRANSFER_PROGRESS frames.
func (b *Bus) ThrottledEmit(key, typ, severity, message string, minInterval time.Duration, data map[string]any) {
	b.lastMu.Lock()
	if t, ok := b.last[key]; ok && time.Since(t) < minInterval {
		b.lastMu.Unlock()
		return
	}
	b.last[key] = time.Now()
	b.lastMu.Unlock()
	b.Emit(typ, severity, message, data)
}

func (b *Bus) Subscribe() chan Event {
	ch := make(chan Event, 256)
	b.mu.Lock()
	b.subs[ch] = true
	b.mu.Unlock()
	return ch
}

func (b *Bus) Unsubscribe(ch chan Event) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	// drain to unblock any sender
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

// Backfill returns persisted events after the given id, oldest first.
func (b *Bus) Backfill(sinceID int64, limit int) ([]Event, error) {
	if b.db == nil {
		return nil, nil
	}
	rows, err := b.db.ListEvents(sinceID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		e := Event{ID: r.ID, Type: r.Type, Severity: r.Severity, Message: r.Message, TS: time.Unix(r.TS, 0).UTC()}
		if r.Data != "" {
			var m map[string]any
			if json.Unmarshal([]byte(r.Data), &m) == nil {
				e.Data = m
			}
		}
		out = append(out, e)
	}
	return out, nil
}
