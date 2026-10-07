package support

import "errors"

// ErrRateLimited is too many claims from one account in the rate-limit window.
var ErrRateLimited = errors.New("too many reports; try again later")

// ErrInvalidClaim is a claim missing required fields or over size limits.
var ErrInvalidClaim = errors.New("invalid support report")
