package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMeasureMessagesSplitsHistoryFromTheCurrentMessage(t *testing.T) {
	stats := MeasureMessages([]Message{
		{Role: RoleSystem, Text: "rules"},
		{Role: RoleUser, Text: "one", Images: []string{"aaaa"}},
		{Role: RoleAssistant, Text: "answer"},
		{Role: RoleUser, Text: "now", Images: []string{"bbbbbb", "cc"}},
	})
	want := BodyStats{
		SystemBytes: 5, HistoryTextBytes: 3 + 6, CurrentTextBytes: 3,
		HistoryImages: 1, HistoryImageBytes: 4, CurrentImages: 2, CurrentImageBytes: 8,
	}
	if stats != want {
		t.Fatalf("stats = %+v, want %+v", stats, want)
	}
}

func TestCompleteReportsBodyProtocolAndSendRate(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(okBody))
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()

	client := NewOpenRouter("sk-test", "openai/gpt-6-luna", server.URL, "")
	client.http = server.Client()
	image := "data:image/jpeg;base64," + strings.Repeat("A", 200_000)
	resp, err := client.Complete(context.Background(), Request{Messages: []Message{
		{Role: RoleSystem, Text: "rules"},
		{Role: RoleUser, Text: "look", Images: []string{image}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Requests) != 1 {
		t.Fatalf("requests = %d", len(resp.Requests))
	}
	request := resp.Requests[0]
	if request.Proto != "h2" {
		t.Fatalf("proto = %q, want h2", request.Proto)
	}
	if request.Body == nil || request.Body.CurrentImages != 1 || request.Body.CurrentImageBytes != len(image) {
		t.Fatalf("body = %+v", request.Body)
	}
	if request.RequestBytes < len(image) {
		t.Fatalf("request bytes = %d", request.RequestBytes)
	}
	if request.SendMs > 0 && request.SendBytesPerSec <= 0 {
		t.Fatalf("a send of %d ms must report its rate", request.SendMs)
	}
	if request.TTFBMs < request.WaitMs {
		t.Fatalf("time to the first byte %d ms is less than the wait %d ms", request.TTFBMs, request.WaitMs)
	}
}
