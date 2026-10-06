"use client";

import { useEffect, useRef, useState } from "react";

/** The preview HTML lays the page out at Letter width; A4 is narrower and fits inside it. */
const PAGE_WIDTH_PX = 816;
/** One Letter page plus the renderer's top margin — what a thumbnail shows. */
const THUMB_HEIGHT_PX = 1080;

/**
 * Server-rendered résumé HTML shown at true page size, scaled down to fit its column.
 * `full` grows to the document's height; `thumb` crops to the first page and ignores the pointer.
 */
export function PaperFrame({
  html,
  title,
  variant = "full",
}: {
  html: string;
  title: string;
  variant?: "full" | "thumb";
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const heightWatch = useRef<ResizeObserver | null>(null);
  const [scale, setScale] = useState(1);
  const [docHeight, setDocHeight] = useState(THUMB_HEIGHT_PX);
  const thumb = variant === "thumb";

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / PAGE_WIDTH_PX));
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      heightWatch.current?.disconnect();
    };
  }, []);

  // Fonts arrive after load and change the height, so keep watching the document.
  const watchHeight = () => {
    if (thumb) return;
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    // The page's own margin sits above and below it; the viewport height would never shrink.
    const measure = () => {
      const page = body.firstElementChild as HTMLElement | null;
      setDocHeight(page ? page.offsetTop * 2 + page.offsetHeight : body.scrollHeight);
    };
    measure();
    heightWatch.current?.disconnect();
    heightWatch.current = new ResizeObserver(measure);
    heightWatch.current.observe(body);
  };

  const height = thumb ? THUMB_HEIGHT_PX : docHeight;

  return (
    <div
      ref={boxRef}
      className={thumb ? "resume-paper resume-paper-thumb" : "resume-paper"}
      style={{ height: height * scale }}
    >
      <iframe
        ref={frameRef}
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        // The frame is sized to the page, so its own scrollbar would only steal width.
        scrolling="no"
        tabIndex={thumb ? -1 : undefined}
        aria-hidden={thumb || undefined}
        onLoad={watchHeight}
        className="resume-paper-page"
        style={{ width: PAGE_WIDTH_PX, height, transform: `scale(${scale})` }}
      />
    </div>
  );
}
