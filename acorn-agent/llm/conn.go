package llm

import (
	"context"
	"net/http"
	"net/http/httptrace"
	"time"
)

// ConnTrace says how a request got its connection: from the pool (Reused), or by opening a new one, which costs a
// TCP and a TLS handshake (about a second from far away). Wait is how long the request waited for its connection.
type ConnTrace struct {
	Reused bool
	Wait   time.Duration
}

// WithConnTrace makes a request fill in how it got its connection.
func WithConnTrace(ctx context.Context, into *ConnTrace) context.Context {
	var asked time.Time
	return httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GetConn: func(string) { asked = time.Now() },
		GotConn: func(info httptrace.GotConnInfo) {
			into.Reused = info.Reused
			if !asked.IsZero() {
				into.Wait = time.Since(asked)
			}
		},
	})
}

// Warm opens a pooled connection to url's host, so the first call does not pay the handshake. It needs no key and
// ignores the answer.
func Warm(ctx context.Context, url string) {
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return
	}
	if response, err := sharedHTTP.Do(request); err == nil {
		response.Body.Close()
	}
}
