import { ACORN_SESSION_COOKIE } from "@acorn/shared/api";

/** The session cookie; the API accepts its value as a bearer token. */
export const SESSION_COOKIE = ACORN_SESSION_COOKIE;

/** Matches acorn-backend's session lifetime. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_SIGN_IN_PATH = "/acorn/auth/signin";
export const AUTH_SIGN_UP_PATH = "/acorn/auth/signup";
export const AUTH_SIGN_OUT_PATH = "/acorn/auth/signout";
export const AUTH_ACCOUNT_PATH = "/acorn/account";
export const AUTH_ME_PATH = "/acorn/auth/me";

/** Where a one-time support code is traded for a support session. */
export { ACORN_SUPPORT_REDEEM_PATH as AUTH_SUPPORT_REDEEM_PATH } from "@acorn/shared/api";
