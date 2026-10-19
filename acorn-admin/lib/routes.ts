import { ATTACHMENT_SIZE, IMAGE_SIZE_PARAM, type AttachmentSize } from "@acorn/support-chat";

export const ROUTES = {
  statistics: "/statistics",
  users: "/users",
  user: (id: string) => `/users/${encodeURIComponent(id)}`,
  claims: "/claims",
  claim: (id: string) => `/claims/${encodeURIComponent(id)}`,
  claimScreenshot: (id: string, size: "thumb" | "view" | "original" = "original") =>
    `/api/claims/${encodeURIComponent(id)}/screenshot?size=${size}`,
  claimDebugLog: (id: string) => `/api/claims/${encodeURIComponent(id)}/debug-log`,
  claimAttachment: (
    id: string,
    attachmentId: string,
    size: AttachmentSize = ATTACHMENT_SIZE.full,
  ) =>
    `/api/claims/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}${
      size === ATTACHMENT_SIZE.thumb ? `?${IMAGE_SIZE_PARAM}=${ATTACHMENT_SIZE.thumb}` : ""
    }`,
  claimMessages: (id: string) => `/api/claims/${encodeURIComponent(id)}/messages`,
  login: "/login",
} as const;

/** Where a signed-in admin lands. */
export const HOME_ROUTE = ROUTES.statistics;
