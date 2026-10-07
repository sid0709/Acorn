const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const shortFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** "Today", "Yesterday", or a short date — the divider above a day's messages. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return dayFormat.format(date);
}

/** The time of day a message was sent. */
export function timeLabel(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** A list row's time: the clock today, otherwise the date. */
export function listTimeLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return sameDay(date, now) ? timeFormat.format(date) : shortFormat.format(date);
}

/** The page's host, or the raw URL when it does not parse. */
export function pageHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What a claim is called in lists: the page title, else its host. */
export function claimTitle(claim: { pageTitle: string; pageUrl: string }): string {
  return claim.pageTitle.trim() || pageHost(claim.pageUrl);
}
