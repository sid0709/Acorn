import { GMAIL_DEFAULT_PAGE_SIZE, GMAIL_PAGE_SIZES } from "./views";

/** How many rows a Gmail page shows, remembered in this browser. */
const PAGE_SIZE_KEY = "acorn.gmail.pageSize";
const PAGE_SIZE_CHANGE = "acorn-gmail-page-size";
/** The choice made on this page, for browsers that refuse storage. */
let chosen: number | null = null;

export function readPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (GMAIL_PAGE_SIZES.includes(stored)) return stored;
  } catch {
    // Fall through to this page's choice.
  }
  return chosen ?? GMAIL_DEFAULT_PAGE_SIZE;
}

export function serverPageSize(): number {
  return GMAIL_DEFAULT_PAGE_SIZE;
}

export function writePageSize(size: number) {
  chosen = size;
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // Private windows can refuse storage; the choice still applies to this page.
  }
  window.dispatchEvent(new Event(PAGE_SIZE_CHANGE));
}

export function subscribePageSize(onChange: () => void) {
  window.addEventListener(PAGE_SIZE_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PAGE_SIZE_CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}
