// Package feed fans one stream of events out to every subscriber in this process. The
// support console's live stream reads it; each subscriber is one open admin tab.
package feed

import "sync"

// subscriberBuffer holds the events a slow reader has not taken yet. Support traffic is a
// few events a minute, so a full buffer means the reader is gone or stuck.
const subscriberBuffer = 64

// Event is one change: a name the reader dispatches on and a JSON-ready payload.
type Event struct {
	Name    string
	Payload any
}

type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func New() *Hub {
	return &Hub{subs: map[chan Event]struct{}{}}
}

// Subscribe returns the reader's events and a cancel that ends them. The channel closes
// on cancel, or when the reader falls a full buffer behind; either way the reader
// reconnects and reloads, so a dropped event is never silently missed.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() { h.drop(ch) }
}

// Publish hands the event to every subscriber without waiting on any of them.
func (h *Hub) Publish(name string, payload any) {
	if h == nil {
		return
	}
	event := Event{Name: name, Payload: payload}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event:
		default:
			delete(h.subs, ch)
			close(ch)
		}
	}
}

func (h *Hub) drop(ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
}
