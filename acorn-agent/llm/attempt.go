package llm

import (
	"context"
	"crypto/tls"
	"net/http/httptrace"
	"sync"
	"time"
)

// Attempt is the timing of one HTTP request to a model provider, split at the points where a
// slow call can be slow: getting a connection, sending the screenshot, the provider thinking, and
// reading the answer back. Times are milliseconds; StartedAt is when the request began.
type Attempt struct {
	StartedAt time.Time `json:"startedAt"`
	// BackoffMs is how long the call waited (a retry delay) before this request.
	BackoffMs int64 `json:"backoffMs,omitempty"`
	// ConnReused is true when an open connection carried the request; ConnectMs (DNS, TCP and
	// TLS) is 0 then.
	ConnReused bool  `json:"connReused"`
	ConnectMs  int64 `json:"connectMs"`
	// Proto is the protocol the connection negotiated ("h2" or "http/1.1"); empty without TLS.
	Proto string `json:"proto,omitempty"`
	// HeadersMs is from a connection being ready to the request's headers being written: the
	// time to the first byte sent.
	HeadersMs int64 `json:"headersMs"`
	// SendMs is from a connection being ready to the request being written out.
	SendMs int64 `json:"sendMs"`
	// SendBytesPerSec is the request's bytes over SendMs: how fast the body went out.
	SendBytesPerSec int64 `json:"sendBytesPerSec"`
	// TTFBMs is from the request beginning to the first byte of the answer.
	TTFBMs int64 `json:"ttfbMs"`
	// WaitMs is from the request being written to the first byte of the answer: the provider's
	// queue and thinking time.
	WaitMs int64 `json:"waitMs"`
	// ReadMs is from the first byte to the whole answer being read.
	ReadMs  int64 `json:"readMs"`
	TotalMs int64 `json:"totalMs"`
	// Status is the HTTP status; 0 when no answer came.
	Status        int `json:"status,omitempty"`
	RequestBytes  int `json:"requestBytes"`
	ResponseBytes int `json:"responseBytes"`
	// Provider is the upstream provider OpenRouter routed the call to, and GenerationID the id to
	// look the call up by in OpenRouter's activity.
	Provider     string `json:"provider,omitempty"`
	GenerationID string `json:"generationId,omitempty"`
	Error        string `json:"error,omitempty"`
	// Body is what the request body was made of; the caller sets it, since it knows the messages.
	Body *BodyStats `json:"body,omitempty"`
}

// Probe times one HTTP request. Begin returns the context to send the request with; Finish
// is called once the answer is read (or the request failed).
type Probe struct {
	mu        sync.Mutex
	started   time.Time
	connStart time.Time
	connDone  time.Time
	gotConn   time.Time
	headers   time.Time
	wrote     time.Time
	firstByte time.Time
	reused    bool
	proto     string
}

// Begin starts timing a request made with the returned context.
func Begin(ctx context.Context) (context.Context, *Probe) {
	p := &Probe{started: time.Now()}
	trace := &httptrace.ClientTrace{
		ConnectStart: func(string, string) { p.set(func() { p.connStart = time.Now() }) },
		ConnectDone:  func(string, string, error) { p.set(func() { p.connDone = time.Now() }) },
		GotConn: func(info httptrace.GotConnInfo) {
			p.set(func() { p.gotConn, p.reused, p.proto = time.Now(), info.Reused, negotiated(info.Conn) })
		},
		WroteHeaders:         func() { p.set(func() { p.headers = time.Now() }) },
		WroteRequest:         func(httptrace.WroteRequestInfo) { p.set(func() { p.wrote = time.Now() }) },
		GotFirstResponseByte: func() { p.set(func() { p.firstByte = time.Now() }) },
	}
	return httptrace.WithClientTrace(ctx, trace), p
}

// negotiated is the protocol a TLS connection agreed on through ALPN; "http/1.1" when it
// agreed on none, and empty for a connection without TLS.
func negotiated(conn interface{ Close() error }) string {
	tlsConn, ok := conn.(*tls.Conn)
	if !ok {
		return ""
	}
	if proto := tlsConn.ConnectionState().NegotiatedProtocol; proto != "" {
		return proto
	}
	return "http/1.1"
}

func (p *Probe) set(fn func()) {
	p.mu.Lock()
	defer p.mu.Unlock()
	fn()
}

// Finish closes the timing. status is 0 and err set when no answer came.
func (p *Probe) Finish(status, requestBytes, responseBytes int, err error) Attempt {
	p.mu.Lock()
	defer p.mu.Unlock()
	end := time.Now()
	a := Attempt{
		StartedAt: p.started, ConnReused: p.reused, TotalMs: end.Sub(p.started).Milliseconds(),
		Status: status, RequestBytes: requestBytes, ResponseBytes: responseBytes,
	}
	if !p.connStart.IsZero() && !p.connDone.IsZero() {
		a.ConnectMs = p.connDone.Sub(p.connStart).Milliseconds()
	}
	// The time before a connection is ready is the connection's (a pool wait, DNS, TLS).
	ready := p.gotConn
	if !ready.IsZero() && !p.reused {
		a.ConnectMs = ready.Sub(p.started).Milliseconds()
	}
	a.Proto = p.proto
	if !ready.IsZero() && !p.headers.IsZero() {
		a.HeadersMs = p.headers.Sub(ready).Milliseconds()
	}
	if !ready.IsZero() && !p.wrote.IsZero() {
		a.SendMs = p.wrote.Sub(ready).Milliseconds()
		if a.SendMs > 0 {
			a.SendBytesPerSec = int64(requestBytes) * 1000 / a.SendMs
		}
	}
	if !p.firstByte.IsZero() {
		a.TTFBMs = p.firstByte.Sub(p.started).Milliseconds()
	}
	if !p.wrote.IsZero() && !p.firstByte.IsZero() {
		a.WaitMs = p.firstByte.Sub(p.wrote).Milliseconds()
	}
	if !p.firstByte.IsZero() {
		a.ReadMs = end.Sub(p.firstByte).Milliseconds()
	}
	if err != nil {
		a.Error = clip(err.Error(), maxErrorText)
	}
	return a
}
