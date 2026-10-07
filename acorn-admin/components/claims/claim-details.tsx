"use client";

import { claimTitle, pageHost, type SupportClaim } from "@acorn/support-chat";
import { useState } from "react";
import {
  Button,
  Glyph,
  Lightbox,
  Link,
  MetadataList,
  MetadataListItem,
  Stack,
  Text,
  Thumbnail,
} from "sid-ui";

import { formatDateTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

/** The report's context: the full-page screenshot, the page, the reporter and their setup. */
export function ClaimDetails({ claim }: { claim: SupportClaim }) {
  const [zoomed, setZoomed] = useState(false);
  const src = ROUTES.claimScreenshot(claim.id);
  const alt = `Full-page screenshot of ${claimTitle(claim)}`;
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <Thumbnail src={src} alt={alt} label="Screenshot" onClick={() => setZoomed(true)} />
        <Button
          label="View full screenshot"
          variant="secondary"
          size="sm"
          icon={<Glyph name="image" />}
          onClick={() => setZoomed(true)}
        />
        {claim.screenshotWidth ? (
          <Text type="supporting" color="secondary">
            {`${claim.screenshotWidth} × ${claim.screenshotHeight} px`}
          </Text>
        ) : null}
      </Stack>
      <MetadataList title="Page">
        <MetadataListItem label="Title">{claimTitle(claim)}</MetadataListItem>
        <MetadataListItem label="Address">
          <Link href={claim.pageUrl} target="_blank" rel="noreferrer">
            {pageHost(claim.pageUrl)}
          </Link>
        </MetadataListItem>
        <MetadataListItem label="Reported">{formatDateTime(claim.createdAt)}</MetadataListItem>
      </MetadataList>
      <MetadataList title="Reporter">
        <MetadataListItem label="Name">
          <Link href={ROUTES.user(claim.accountId)}>{claim.userName || claim.userEmail}</Link>
        </MetadataListItem>
        <MetadataListItem label="Email">{claim.userEmail}</MetadataListItem>
        <MetadataListItem label="Extension">
          {claim.extensionVersion ? `v${claim.extensionVersion}` : "—"}
        </MetadataListItem>
        <MetadataListItem label="Chrome tab">{claim.tabKey || "—"}</MetadataListItem>
      </MetadataList>
      <Lightbox
        isOpen={zoomed}
        onOpenChange={setZoomed}
        media={{ src, alt, caption: claim.pageUrl }}
        hasZoom
      />
    </Stack>
  );
}
