export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function shortHash(hash: string, head = 10, tail = 6): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** Timestamps are rendered in UTC so server and client output match. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : `${DATE.format(date)} UTC`;
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "date unavailable" : DAY.format(date);
}
