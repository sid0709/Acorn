import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildEmailDocument, hasRemoteImages } from "../../../shared/email-document";
import { formatRelativeTime } from "../../../shared/relative-time";
import {
  fetchEmail,
  fetchEmails,
  type OakEmailMessage,
  type OakEmailRow,
} from "../pipeline/ai-client";
import { BackIcon, RefreshIcon } from "./sidebar-icons";

type EmailsPanelProps = {
  /** True while the Emails tab is showing; the list is read each time it opens. */
  active: boolean;
};

type Opened = { row: OakEmailRow; message: OakEmailMessage | null; error: string | null };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function senderName(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return (named?.[1] || from).trim() || "Unknown sender";
}

function formatFullDate(at: number): string {
  return at ? new Date(at).toLocaleString() : "";
}

/** Verification emails the Gmail watcher labelled `oak-verify-email`, and each one in full. */
export function EmailsPanel({ active }: EmailsPanelProps) {
  const [rows, setRows] = useState<OakEmailRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [showImages, setShowImages] = useState(false);
  // Only the newest request may write its answer: a slow earlier one must not replace it.
  const listRequest = useRef(0);
  const openRequest = useRef(0);

  const loadList = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setListError(null);
    try {
      const next = await fetchEmails();
      if (request === listRequest.current) setRows(next);
    } catch (err) {
      if (request === listRequest.current) setListError(errorText(err));
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void loadList();
  }, [active, loadList]);

  const open = useCallback(async (row: OakEmailRow) => {
    const request = ++openRequest.current;
    setShowImages(false);
    setOpened({ row, message: null, error: null });
    try {
      const message = await fetchEmail(row.mailboxId, row.id);
      if (request === openRequest.current) setOpened({ row, message, error: null });
    } catch (err) {
      if (request === openRequest.current) setOpened({ row, message: null, error: errorText(err) });
    }
  }, []);

  const close = useCallback(() => {
    openRequest.current += 1;
    setOpened(null);
  }, []);

  const message = opened?.message ?? null;
  const remoteImages = useMemo(() => (message ? hasRemoteImages(message.html) : false), [message]);
  const srcDoc = useMemo(
    () =>
      message ? buildEmailDocument({ html: message.html, text: message.text }, showImages) : "",
    [message, showImages],
  );

  if (opened) {
    return (
      <section className="emails-panel emails-detail">
        <button type="button" className="emails-back" onClick={close}>
          <BackIcon />
          <span>Emails</span>
        </button>
        <header className="emails-head">
          <h3 className="emails-subject">{opened.row.subject || "(no subject)"}</h3>
          <dl className="emails-meta">
            <dt>From</dt>
            <dd>{message?.from || opened.row.from}</dd>
            {message?.to ? (
              <>
                <dt>To</dt>
                <dd>{message.to}</dd>
              </>
            ) : null}
            {message?.cc ? (
              <>
                <dt>Cc</dt>
                <dd>{message.cc}</dd>
              </>
            ) : null}
            <dt>Date</dt>
            <dd>{formatFullDate(message?.date || opened.row.receivedAt)}</dd>
            {message?.attachments.length ? (
              <>
                <dt>Files</dt>
                <dd>{message.attachments.map((file) => file.filename).join(", ")}</dd>
              </>
            ) : null}
          </dl>
        </header>
        {opened.error ? <p className="emails-error">{opened.error}</p> : null}
        {!message && !opened.error ? <p className="hint">Opening…</p> : null}
        {message && remoteImages && !showImages ? (
          <div className="emails-images-bar">
            <span>Remote images blocked</span>
            <button type="button" onClick={() => setShowImages(true)}>
              Load images
            </button>
          </div>
        ) : null}
        {message ? (
          <iframe
            className="emails-frame"
            title={opened.row.subject || "Email"}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="emails-panel">
      <div className="emails-toolbar">
        <h3>Emails</h3>
        <button
          type="button"
          className="emails-refresh"
          onClick={() => void loadList()}
          disabled={loading}
          aria-label="Refresh emails"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>
      {listError ? <p className="emails-error">{listError}</p> : null}
      {rows === null && loading ? <p className="hint">Loading…</p> : null}
      {rows && rows.length === 0 && !listError ? (
        <p className="hint">No verification emails yet</p>
      ) : null}
      {rows && rows.length ? (
        <ul className="emails-list">
          {rows.map((row) => (
            <li key={`${row.mailboxId}:${row.id}`}>
              <button type="button" className="emails-row" onClick={() => void open(row)}>
                <span className={`emails-dot${row.unread ? " unread" : ""}`} aria-hidden="true" />
                <span className="emails-row-main">
                  <span className="emails-row-top">
                    <span className="emails-from">{senderName(row.from)}</span>
                    <span className="emails-when">{formatRelativeTime(row.receivedAt)}</span>
                  </span>
                  <span className="emails-row-subject">{row.subject || "(no subject)"}</span>
                  <span className="emails-row-snippet">{row.snippet}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
