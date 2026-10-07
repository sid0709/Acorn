package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
)

// ErrorKind values say why a model call failed, so usage stats can group failures.
const (
	ErrorKindCancelled     = "cancelled"
	ErrorKindTimeout       = "timeout"
	ErrorKindRateLimited   = "rate_limited"
	ErrorKindAuth          = "auth"
	ErrorKindBadRequest    = "bad_request"
	ErrorKindProvider      = "provider_error"
	ErrorKindNetwork       = "network"
	ErrorKindEmptyResponse = "empty_response"
	ErrorKindParse         = "parse_error"
	ErrorKindNoAPIKey      = "no_api_key"
)

// ErrEmptyResponse is a 2xx reply with no content.
var ErrEmptyResponse = errors.New("model returned an empty job")

// ClassifyError names the kind of failure for err and the last HTTP status.
// It returns "" when err is nil.
func ClassifyError(err error, status int) string {
	if err == nil {
		return ""
	}
	var syntax *json.SyntaxError
	var typed *json.UnmarshalTypeError
	var netErr net.Error
	switch {
	case errors.Is(err, context.Canceled):
		return ErrorKindCancelled
	case errors.Is(err, context.DeadlineExceeded):
		return ErrorKindTimeout
	case errors.Is(err, ErrMissingAPIKey), errors.Is(err, ErrMissingOpenRouterKey):
		return ErrorKindNoAPIKey
	case errors.Is(err, ErrEmptyResponse):
		return ErrorKindEmptyResponse
	case errors.As(err, &syntax), errors.As(err, &typed):
		return ErrorKindParse
	case status == http.StatusTooManyRequests:
		return ErrorKindRateLimited
	case status == http.StatusUnauthorized, status == http.StatusForbidden, status == http.StatusPaymentRequired:
		return ErrorKindAuth
	case status == http.StatusRequestTimeout, status == http.StatusGatewayTimeout:
		return ErrorKindTimeout
	case status >= http.StatusInternalServerError:
		return ErrorKindProvider
	case status >= http.StatusBadRequest:
		return ErrorKindBadRequest
	case errors.As(err, &netErr) && netErr.Timeout():
		return ErrorKindTimeout
	case status == 0:
		return ErrorKindNetwork
	}
	return ErrorKindProvider
}
