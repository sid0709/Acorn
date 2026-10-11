export const ROUTES = {
  statistics: "/statistics",
  users: "/users",
  user: (id: string) => `/users/${encodeURIComponent(id)}`,
  claims: "/claims",
  claim: (id: string) => `/claims/${encodeURIComponent(id)}`,
  claimScreenshot: (id: string, size: "thumb" | "view" | "original" = "original") =>
    `/api/claims/${encodeURIComponent(id)}/screenshot?size=${size}`,
  claimAttachment: (id: string, attachmentId: string) =>
    `/api/claims/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
  claimMessages: (id: string) => `/api/claims/${encodeURIComponent(id)}/messages`,
  login: "/login",
} as const;

/** Where a signed-in admin lands. */
export const HOME_ROUTE = ROUTES.statistics;
