import { GMAIL_DEFAULT_PAGE_SIZE, GMAIL_PAGE_SIZES } from "./views";

/** How many rows a Gmail page shows, remembered in this browser. */
const PAGE_SIZE_KEY = "acorn.gmail.pageSize";
const PAGE_SIZE_CHANGE = "acorn-gmail-page-size";
const AUTOLABEL_PAGE_SIZE_KEY = "acorn.gmail.autolabelPageSize";
const AUTOLABEL_PAGE_SIZE_CHANGE = "acorn-gmail-autolabel-page-size";

function pageSizeStore(storageKey: string, eventName: string) {
  /** The choice made on this page, for browsers that refuse storage. */
  let chosen: number | null = null;
  return {
    read(): number {
      try {
        const stored = Number(localStorage.getItem(storageKey));
        if (GMAIL_PAGE_SIZES.includes(stored)) return stored;
      } catch {
        // Fall through to this page's choice.
      }
      return chosen ?? GMAIL_DEFAULT_PAGE_SIZE;
    },
    server(): number {
      return GMAIL_DEFAULT_PAGE_SIZE;
    },
    write(size: number) {
      chosen = size;
      try {
        localStorage.setItem(storageKey, String(size));
      } catch {
        // Private windows can refuse storage; the choice still applies to this page.
      }
      window.dispatchEvent(new Event(eventName));
    },
    subscribe(onChange: () => void) {
      window.addEventListener(eventName, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(eventName, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
  };
}

const inboxPageSize = pageSizeStore(PAGE_SIZE_KEY, PAGE_SIZE_CHANGE);
const autolabelPageSize = pageSizeStore(AUTOLABEL_PAGE_SIZE_KEY, AUTOLABEL_PAGE_SIZE_CHANGE);

export const readPageSize = inboxPageSize.read;
export const serverPageSize = inboxPageSize.server;
export const writePageSize = inboxPageSize.write;
export const subscribePageSize = inboxPageSize.subscribe;

export const readAutolabelPageSize = autolabelPageSize.read;
export const serverAutolabelPageSize = autolabelPageSize.server;
export const writeAutolabelPageSize = autolabelPageSize.write;
export const subscribeAutolabelPageSize = autolabelPageSize.subscribe;
