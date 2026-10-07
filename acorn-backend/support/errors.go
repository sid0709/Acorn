package support

import "errors"

// ErrRateLimited is too many claims or messages from one account in the rate-limit window.
var ErrRateLimited = errors.New("too many reports; try again later")

// ErrInvalidClaim is a claim missing required fields or over size limits.
var ErrInvalidClaim = errors.New("invalid support report")

// ErrInvalidMessage is an empty or over-long message.
var ErrInvalidMessage = errors.New("write a message of up to 4000 characters")
