package acornapi

import (
	"context"
	"net/http"
)

type requestSessionKey struct{}

// requestSession carries what session() learned about the caller to code that
// runs later in the same request, such as the usage recorder.
type requestSession struct {
	supportBy string
}

// withRequestSession gives every request a slot that session() fills in.
func withRequestSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), requestSessionKey{}, &requestSession{})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestSessionFrom(ctx context.Context) *requestSession {
	held, _ := ctx.Value(requestSessionKey{}).(*requestSession)
	return held
}

// supportByFrom is the admin running this request's support session, or "".
func supportByFrom(ctx context.Context) string {
	if held := requestSessionFrom(ctx); held != nil {
		return held.supportBy
	}
	return ""
}
