import { useState } from "react";
import { HStack, Lightbox, Thumbnail } from "sid-ui";

import { ATTACHMENT_SIZE, type AttachmentSize, type SupportAttachment } from "./types";

const FALLBACK_ALT = "Attached image";

/**
 * A message's images as thumbnails; one opens them all in a lightbox, starting there. The
 * thumbnails load the small copy; the lightbox asks for the originals, and shows the small
 * copy until each one arrives.
 */
export function MessageAttachments({
  attachments,
  srcFor,
  onOpen,
}: {
  attachments: SupportAttachment[];
  /** Where to load a copy of an image from; undefined while it is still on its way. */
  srcFor: (attachment: SupportAttachment, size: AttachmentSize) => string | undefined;
  /** The lightbox opened on these images: start loading their originals if they are not at hand. */
  onOpen?: (attachments: SupportAttachment[]) => void;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const shown = attachments.map((attachment) => {
    const thumb = srcFor(attachment, ATTACHMENT_SIZE.thumb);
    return {
      attachment,
      thumb,
      full: srcFor(attachment, ATTACHMENT_SIZE.full) ?? thumb,
      alt: attachment.name || FALLBACK_ALT,
    };
  });
  const ready = shown.filter((item) => item.full);
  return (
    <>
      <HStack gap={2} wrap="wrap">
        {shown.map(({ attachment, thumb, full, alt }) => (
          <Thumbnail
            key={attachment.id}
            src={thumb ?? full}
            alt={alt}
            label={alt}
            isLoading={!thumb && !full}
            onClick={
              thumb || full
                ? () => {
                    setOpenAt(ready.findIndex((item) => item.attachment.id === attachment.id));
                    onOpen?.(ready.map((item) => item.attachment));
                  }
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
          media={ready.map(({ full, alt }) => ({ src: full as string, alt }))}
          defaultIndex={openAt}
          hasZoom
        />
      ) : null}
    </>
  );
}
