// Package requestid carries the HTTP request id on a context so model logs can
// name the same request as the access log without importing the HTTP stack.
package requestid

import "context"

type key struct{}

// With stores id on ctx. An empty id leaves ctx unchanged.
func With(ctx context.Context, id string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, key{}, id)
}

// From returns the id stored by With, or "" when none is set.
func From(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(key{}).(string)
	return id
}
