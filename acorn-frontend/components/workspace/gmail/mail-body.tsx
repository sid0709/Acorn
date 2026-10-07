"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The message as Gmail shows it: the sender's own HTML (or the plain text) in a
 * sandboxed frame. Scripts, forms, and plugins never run; links open in a new tab.
 * `allow-same-origin` without `allow-scripts` lets this page size the frame to its
 * content while the mail itself still cannot run code.
 */
const SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const CSP =
  "default-src 'none'; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:; media-src * data:";

/**
 * Gmail's defaults for mail without its own styles. Mail is designed for a light page,
 * so the frame keeps a light canvas even in dark mode, like Gmail does.
 */
const FRAME_CSS = [
  ":root{color-scheme:light;background:Canvas;color:CanvasText}",
  "body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:small;overflow-wrap:anywhere}",
  ".plain{white-space:pre-wrap}",
].join("");

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/g;

function escapeHTML(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text with its links made clickable, as Gmail does. */
function plainToHTML(text: string) {
  const escaped = escapeHTML(text);
  return `<div class="plain">${escaped.replace(URL_PATTERN, (url) => `<a href="${url}">${url}</a>`)}</div>`;
}

export function frameDocument(html: string, text: string) {
  const body = html || plainToHTML(text);
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<base target="_blank">',
    `<style>${FRAME_CSS}</style>`,
    `</head><body>${body}</body></html>`,
  ].join("");
}

export function MailBody({ html, text, title }: { html: string; text: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const doc = useMemo(() => frameDocument(html, text), [html, text]);

  const measure = useCallback(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root) setHeight(root.scrollHeight);
  }, []);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    let observer: ResizeObserver | null = null;
    const onLoad = () => {
      measure();
      const body = node.contentDocument?.body;
      if (!body) return;
      // Images and web fonts arrive after load; keep the frame as tall as its content.
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(body);
    };
    node.addEventListener("load", onLoad);
    return () => {
      node.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [measure]);

  return (
    <iframe
      ref={frame}
      className="gmail-message-frame"
      title={title}
      sandbox={SANDBOX}
      srcDoc={doc}
      referrerPolicy="no-referrer"
      style={height ? { height } : undefined}
    />
  );
}
