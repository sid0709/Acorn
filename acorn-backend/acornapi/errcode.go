package acornapi

import (
	"errors"
	"net"
	"net/http"

	"github.com/sid0709/acorn/acorn-backend/acorn"
	"github.com/sid0709/acorn/acorn-backend/openai"
)

// Error codes the extension turns into plain words (see @acorn/shared user-messages).
// A code is stable; the message beside it is for logs and may change.
const (
	CodeSignedOut        = "signed_out"
	CodeKillSwitch       = "kill_switch"
	CodeNoKey            = "openrouter_no_key"
	CodeInvalidKey       = "openrouter_invalid_key"
	CodeNoCredits        = "openrouter_no_credits"
	CodeRateLimited      = "openrouter_rate_limited"
	CodeProviderDown     = "provider_error"
	CodeModelTimeout     = "model_timeout"
	CodeModelBadAnswer   = "model_bad_answer"
	CodeModelUnavailable = "model_unavailable"
)

// modelErrorCode names why a model call failed, or "" when err is not one the person
// can act on. The status comes from the provider's own refusal.
func modelErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, acorn.ErrModelUnavailable) {
		return CodeModelUnavailable
	}
	var refused *openai.StatusError
	if errors.As(err, &refused) {
		switch {
		case refused.Status == http.StatusPaymentRequired:
			return CodeNoCredits
		case refused.Status == http.StatusUnauthorized, refused.Status == http.StatusForbidden:
			return CodeInvalidKey
		case refused.Status == http.StatusTooManyRequests:
			return CodeRateLimited
		case refused.Status == http.StatusRequestTimeout, refused.Status == http.StatusGatewayTimeout:
			return CodeModelTimeout
		case refused.Status >= http.StatusInternalServerError:
			return CodeProviderDown
		}
		return ""
	}
	var netErr net.Error
	// Only failures the classifier is sure of: it calls every unknown error a provider's.
	switch kind := openai.ClassifyError(err, 0); {
	case kind == openai.ErrorKindNoAPIKey:
		return CodeNoKey
	case kind == openai.ErrorKindTimeout:
		return CodeModelTimeout
	case kind == openai.ErrorKindParse, kind == openai.ErrorKindEmptyResponse:
		return CodeModelBadAnswer
	case errors.As(err, &netErr):
		return CodeProviderDown
	}
	return ""
}

// statusForCode is the HTTP status a coded model failure is answered with.
func statusForCode(code string, fallback int) int {
	switch code {
	case CodeNoCredits:
		return http.StatusPaymentRequired
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodeNoKey, CodeModelUnavailable:
		return http.StatusServiceUnavailable
	}
	return fallback
}

// writeCodedError answers with the usual error body and a stable `code`.
func writeCodedError(w http.ResponseWriter, status int, code, message string) {
	body := map[string]any{"success": false, "error": message, "message": message}
	if code != "" {
		body["code"] = code
	}
	writeJSON(w, status, body)
}

// errorBody is the body of a run route's `ok:false` answer, with the error's code.
func errorBody(err error) map[string]any {
	body := map[string]any{"ok": false, "error": err.Error()}
	if code := modelErrorCode(err); code != "" {
		body["code"] = code
	}
	return body
}
