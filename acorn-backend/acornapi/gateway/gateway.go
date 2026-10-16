// Package gateway is Acorn's Socket.IO endpoint at /acorn/socket.io: the side panel, the UI
// board and the extension meet here, one private room per Acorn account.
package gateway

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/zishang520/socket.io/servers/socket/v3"
	"github.com/zishang520/socket.io/v3/pkg/types"
)

const (
	// Path is the Engine.IO path the extension connects to, inside acornapi.Prefix.
	Path = "/acorn/socket.io"
	// maxBuffer is the largest message a socket accepts.
	maxBuffer = 16e6
)

// Account is who a socket token belongs to.
type Account struct {
	ID   string
	Name string
}

// Authenticate resolves a session token to an account.
type Authenticate func(ctx context.Context, token string) (Account, error)

type Gateway struct {
	io       *socket.Server
	registry *Registry
	auth     Authenticate
}

func New(auth Authenticate) *Gateway {
	g := &Gateway{registry: NewRegistry(), auth: auth}
	opts := socket.DefaultServerOptions()
	opts.SetPath(Path)
	opts.SetMaxHttpBufferSize(maxBuffer)
	opts.SetPerMessageDeflate(nil)
	// The token travels in the handshake payload, never a cookie the browser would attach on its own.
	opts.SetCors(&types.Cors{Origin: "*"})
	g.io = socket.NewServer(nil, opts)
	g.io.Use(g.authenticate)
	g.io.On("connection", func(args ...any) { g.onConnection(args[0].(*socket.Socket)) })
	return g
}

// Handler serves the Engine.IO endpoint.
func (g *Gateway) Handler() http.Handler { return g.io.ServeHandler(nil) }

func (g *Gateway) Close() { g.io.Close(nil) }

// Token reads the handshake token: the auth payload, or an Authorization header.
// A query-string token is never accepted: URLs land in proxy access logs.
func Token(auth map[string]any, header string) string {
	if token, ok := auth["token"].(string); ok && strings.TrimSpace(token) != "" {
		return strings.TrimSpace(token)
	}
	if token, ok := strings.CutPrefix(strings.TrimSpace(header), "Bearer "); ok {
		return strings.TrimSpace(token)
	}
	return ""
}

func (g *Gateway) authenticate(sock *socket.Socket, next func(*socket.ExtendedError)) {
	handshake := sock.Handshake()
	header := ""
	if handshake.Headers != nil {
		header = handshake.Headers.Header().Get("Authorization")
	}
	token := Token(handshake.Auth, header)
	if token == "" {
		next(socket.NewExtendedError("Acorn session required", nil))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	account, err := g.auth(ctx, token)
	if err != nil {
		message := "Acorn session expired or invalid"
		if !errors.Is(err, ErrUnauthorized) {
			slog.Error("acorn socket auth", "error", err)
			message = "Acorn session could not be checked"
		}
		next(socket.NewExtendedError(message, nil))
		return
	}
	sock.SetData(account)
	next(nil)
}

// ErrUnauthorized is the token is not a live session.
var ErrUnauthorized = errors.New("unauthorized")

func room(accountID string) socket.Room { return socket.Room("acorn:acct:" + accountID) }

// UsageRecordedEvent tells every client of an account that one AI call was
// recorded; the payload names the tab it belongs to. The same string is
// SOCKET_EVENT.aiUsageRecorded in the extension.
const UsageRecordedEvent = "ai-usage:recorded"

// SupportMessageEvent tells the reporter's clients about a new message on a claim (from
// either side), and SupportClaimEvent that a claim was opened or closed. The same strings
// are SOCKET_EVENT.supportMessage and SOCKET_EVENT.supportClaim in the extension, and the
// event names on the support console's stream (acornapi adminClaimEvents).
const (
	SupportMessageEvent = "support:message"
	SupportClaimEvent   = "support:claim"
)

// EmitToAccount sends one event to every connected client of the account.
func (g *Gateway) EmitToAccount(accountID, event string, payload any) {
	if g == nil || g.io == nil || accountID == "" {
		return
	}
	_ = g.io.To(room(accountID)).Emit(event, payload)
}

func queryValue(sock *socket.Socket, key string) string {
	return sock.Handshake().Query.Query().Get(key)
}

func (g *Gateway) onConnection(sock *socket.Socket) {
	account := sock.Data().(Account)
	r := room(account.ID)
	kind := queryValue(sock, "type")
	if kind == "" {
		kind = "unknown"
	}
	name := queryValue(sock, "name")
	if name == "" {
		name = account.Name
	}
	if name == "" {
		name = "anonymous"
	}

	sock.Join(r)
	client := g.registry.Add(sock, Client{AccountID: account.ID, Type: kind, Name: name, ProfileID: account.ID, ApplierName: account.Name})
	slog.Info("acorn socket connected", "type", kind, "name", name, "id", client.ID)

	_ = sock.Emit("connected", map[string]any{"id": client.ID, "type": kind, "clients": g.registry.SummaryFor(account.ID)})
	_ = g.io.To(r).Emit("clients:update", g.registry.SummaryFor(account.ID))

	sock.On("pipeline:progress", func(args ...any) {
		_ = sock.To(r).Emit("pipeline:progress", firstPayload(args))
	})

	sock.On("disconnect", func(...any) {
		g.registry.Remove(client.ID)
		slog.Info("acorn socket disconnected", "type", kind, "name", name, "id", client.ID)
		_ = g.io.To(r).Emit("clients:update", g.registry.SummaryFor(account.ID))
	})
}

func firstPayload(args []any) map[string]any {
	if len(args) > 0 {
		if payload, ok := args[0].(map[string]any); ok {
			return payload
		}
	}
	return map[string]any{}
}
