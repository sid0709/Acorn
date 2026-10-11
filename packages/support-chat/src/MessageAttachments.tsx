import { useState } from "react";
import { HStack, Lightbox, Thumbnail } from "sid-ui";

import type { SupportAttachment } from "./types";

const FALLBACK_ALT = "Attached image";

/** A message's images as thumbnails; one opens them all in a lightbox, starting there. */
export function MessageAttachments({
  attachments,
  srcFor,
}: {
  attachments: SupportAttachment[];
  /** Where to load an image from; undefined while it is still on its way. */
  srcFor: (attachment: SupportAttachment) => string | undefined;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const shown = attachments.map((attachment) => ({
    attachment,
    src: srcFor(attachment),
    alt: attachment.name || FALLBACK_ALT,
  }));
  const ready = shown.filter((item) => item.src);
  return (
    <>
      <HStack gap={2} wrap="wrap">
        {shown.map(({ attachment, src, alt }) => (
          <Thumbnail
            key={attachment.id}
            src={src}
            alt={alt}
            label={alt}
            isLoading={!src}
            onClick={
              src
                ? () => setOpenAt(ready.findIndex((item) => item.attachment.id === attachment.id))
                : undefined
            }
          />
        ))}
      </HStack>
      {openAt !== null && ready.length ? (
        <Lightbox
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setOpenAt(null);
          }}
          media={ready.map(({ src, alt }) => ({ src: src as string, alt }))}
          defaultIndex={openAt}
          hasZoom
        />
      ) : null}
    </>
  );
}
