/**
 * Ids and the clock a run starts with. The run's id comes from the
 * turn's idempotency key, so sending the same turn twice names the same run and can't start a second.
 */

async function stableUuid(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const runIdFor = async (account: string, idempotencyKey: string) =>
  `invocation_${await stableUuid(`run\n${account}\n${idempotencyKey}`)}`;

export const conversationIdFor = async (account: string, idempotencyKey: string) =>
  `conversation_${await stableUuid(`conversation\n${account}\n${idempotencyKey}`)}`;

/** What a follower uses to name a run, in place of the address its stream had on the server. */
export const followAddress = (runId: string) => `agent-run:${runId}`;

export function runIdOfFollowAddress(address: string): string {
  return address.startsWith("agent-run:") ? address.slice("agent-run:".length) : address;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * RFC 3339 at this moment in a timezone, written as Go writes it, `Z` when the offset is zero. The
 * prompt's date is its first ten characters, so it has to be the person's date, not the UTC one.
 */
export function goNow(timezone: string, now = new Date()): string {
  let formatter: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  const [year, month, day, hour, minute, second] = [
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ].map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((wall - Math.floor(now.getTime() / 1000) * 1000) / 60_000);
  const date = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  if (offsetMinutes === 0) return `${date}Z`;
  const size = Math.abs(offsetMinutes);
  return `${date}${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}
