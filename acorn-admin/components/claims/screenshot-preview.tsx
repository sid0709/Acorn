"use client";

import { useState } from "react";
import { Button, Drawer, Glyph } from "sid-ui";

import { ROUTES } from "@/lib/routes";

/**
 * A claim's screenshot: a crisp preview of the top of the page that opens a drawer with the
 * whole page, scrolling at full width. Both are small WebP copies cached by the browser; the
 * larger one is fetched as the pointer arrives, so the drawer opens already loaded.
 */
export function ScreenshotPreview({
  claimId,
  alt,
  caption,
}: {
  claimId: string;
  alt: string;
  caption: string;
}) {
  const [isOpen, setOpen] = useState(false);
  const [isLoaded, setLoaded] = useState(false);
  const [hasFailed, setFailed] = useState(false);
  const warmViewer = () => {
    new Image().src = ROUTES.claimScreenshot(claimId, "view");
  };
  return (
    <>
      <button
        type="button"
        className="claim-shot"
        aria-label="View full screenshot"
        onPointerEnter={warmViewer}
        onFocus={warmViewer}
        onClick={() => setOpen(true)}
        data-loaded={isLoaded || hasFailed}
      >
        {hasFailed ? null : (
          <img
            key={claimId}
            src={ROUTES.claimScreenshot(claimId, "thumb")}
            alt={alt}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </button>
      <Button
        label="View full screenshot"
        variant="secondary"
        size="sm"
        icon={<Glyph name="image" />}
        onClick={() => setOpen(true)}
      />
      <Drawer
        isOpen={isOpen}
        onOpenChange={setOpen}
        title="Screenshot"
        subtitle={caption}
        size="lg"
      >
        {isOpen ? (
          <img
            className="claim-shot-full"
            src={ROUTES.claimScreenshot(claimId, "view")}
            alt={alt}
          />
        ) : null}
      </Drawer>
    </>
  );
}
