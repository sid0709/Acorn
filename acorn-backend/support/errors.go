package support

import "errors"

// ErrRateLimited is too many claims or messages from one account in the rate-limit window.
var ErrRateLimited = errors.New("too many reports; try again later")

// ErrInvalidClaim is a claim missing required fields or over size limits.
var ErrInvalidClaim = errors.New("invalid support report")

// ErrInvalidMessage is an empty or over-long message.
var ErrInvalidMessage = errors.New("write a message of up to 4000 characters")

// ErrInvalidAttachment is a file that is not a PNG, JPEG, GIF, or WebP image within the size limit.
var ErrInvalidAttachment = errors.New("attach PNG, JPEG, GIF, or WebP images of up to 8 MB")
