import type { RuntimeMessage, SendResponse } from "./shared";

/** The DevTools protocol version the debugger speaks. */
const DEBUGGER_PROTOCOL_VERSION = "1.3";
/** What Chrome says when no debugger of this extension is on the tab yet. */
const NOT_ATTACHED = /not attached/i;

/**
 * Type text into the field the page has focused, as the browser itself does: the input
 * events are trusted, which a page's script cannot tell from a person's typing. A field
 * that keeps its own state (a masked date, a tag box) and ignores the value a script sets
 * takes it this way. The run's debugger session is used when there is one; otherwise one
 * is attached for this typing and let go of after.
 */
export function handleTypeTrusted(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): void {
  const tabId = sender.tab?.id;
  const text = typeof message.text === "string" ? message.text : "";
  if (tabId == null || !text) {
    sendResponse({ ok: false, error: "tab and text are required" });
    return;
  }
  void (async () => {
    const insert = () => chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
    try {
      try {
        await insert();
      } catch (err) {
        if (!NOT_ATTACHED.test(err instanceof Error ? err.message : String(err))) throw err;
        await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
        try {
          await insert();
        } finally {
          await chrome.debugger.detach({ tabId }).catch(() => undefined);
        }
      }
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
}
