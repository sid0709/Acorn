export const ROUTES = {
  statistics: "/statistics",
  users: "/users",
  user: (id: string) => `/users/${encodeURIComponent(id)}`,
  claims: "/claims",
  claim: (id: string) => `/claims/${encodeURIComponent(id)}`,
  claimScreenshot: (id: string) => `/api/claims/${encodeURIComponent(id)}/screenshot`,
  login: "/login",
} as const;

/** Where a signed-in admin lands. */
export const HOME_ROUTE = ROUTES.statistics;
