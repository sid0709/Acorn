package decide

import (
	"context"
	"fmt"
)

// Keys are the person's keys a decision may be asked on: OpenRouter's (Jev, and GPT-6 Luna Decisions on
// OpenRouter) and OpenAI's own (GPT-6 Luna on OpenAI's Decisions API). Both come from the profile.
type Keys struct {
	OpenRouter string
	OpenAI     string
}

// The providers a decision can be asked of.
const (
	ProviderOpenRouter = "openrouter"
	ProviderOpenAI     = "openai"
)

// Route is where one kind of decision is asked: a provider's Decisions API at URL, and the model there.
type Route struct {
	Provider string
	Model    string
	URL      string
}

// Routes names where each kind of decision goes: one whose state is text only, and one whose state holds a
// picture. ImageFallback is where the picture ones go when Image is on OpenAI and the profile has no OpenAI
// key, so a run without one still checks its screens.
type Routes struct {
	Text          Route
	Image         Route
	ImageFallback Route
}

// Gateway is every decision the agent asks, sent to the route for its kind: a state with a picture in it
// to the image route, any other to the text route. The answer says which model gave it.
type Gateway struct {
	text  *Client
	image *Client
	names string
}

// NewGateway is a gateway on the person's keys.
func NewGateway(keys Keys, routes Routes) *Gateway {
	image := routes.Image
	if image.Provider == ProviderOpenAI && keys.OpenAI == "" {
		image = routes.ImageFallback
	}
	return &Gateway{
		text:  clientFor(keys, routes.Text),
		image: clientFor(keys, image),
		names: fmt.Sprintf("text %s on %s, image %s on %s", routes.Text.Model, routes.Text.Provider, image.Model, image.Provider),
	}
}

// clientFor is the client of a route, on the key of its provider.
func clientFor(keys Keys, route Route) *Client {
	if route.Provider == ProviderOpenAI {
		return NewOpenAI(keys.OpenAI, route.Model, route.URL)
	}
	return New(keys.OpenRouter, route.Model, route.URL)
}

// Decide sends the decision to the route for its kind.
func (g *Gateway) Decide(ctx context.Context, req Request) (Response, error) {
	if hasImage(req.State) {
		return g.image.Decide(ctx, req)
	}
	return g.text.Decide(ctx, req)
}

// Name says which model answers each kind, and where, for the trace.
func (g *Gateway) Name() string { return g.names }

// hasImage is whether a state holds a picture.
func hasImage(state []Part) bool {
	for _, part := range state {
		if part.Type == partImage {
			return true
		}
	}
	return false
}
