package feed

import "testing"

func TestPublishReachesEverySubscriber(t *testing.T) {
	hub := New()
	a, cancelA := hub.Subscribe()
	defer cancelA()
	b, cancelB := hub.Subscribe()
	defer cancelB()

	hub.Publish("support:message", "hello")
	for _, ch := range []<-chan Event{a, b} {
		got := <-ch
		if got.Name != "support:message" || got.Payload != "hello" {
			t.Fatalf("event = %+v", got)
		}
	}
}

func TestCancelClosesAndStopsDelivery(t *testing.T) {
	hub := New()
	ch, cancel := hub.Subscribe()
	cancel()
	cancel()
	hub.Publish("support:claim", nil)
	if _, open := <-ch; open {
		t.Fatal("channel still open after cancel")
	}
}

func TestSlowSubscriberIsDroppedNotWaitedOn(t *testing.T) {
	hub := New()
	slow, cancel := hub.Subscribe()
	defer cancel()
	for range subscriberBuffer + 1 {
		hub.Publish("support:message", nil)
	}
	n := 0
	for range slow {
		n++
	}
	if n != subscriberBuffer {
		t.Fatalf("delivered %d before closing, want %d", n, subscriberBuffer)
	}
}

func TestNilHubPublishIsANoOp(t *testing.T) {
	var hub *Hub
	hub.Publish("support:claim", nil)
}
