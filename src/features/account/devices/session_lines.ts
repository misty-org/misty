import type { AccountSession } from "./device_sign_in_api";

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

export function sessionName(session: AccountSession): string {
  return session.name.trim() || "Unnamed device";
}

export function sessionLine(session: AccountSession, now: number): string {
  if (session.current) return "This device";
  const used = session.last_used_at ? ago(session.last_used_at, now) : "";
  if (used) return `Last used ${used}`;
  const made = ago(session.created_at, now);
  return made ? `Signed in ${made}` : "";
}

function lastSeen(session: AccountSession): number {
  const at = Date.parse(session.last_used_at || session.created_at);
  return Number.isFinite(at) ? at : 0;
}

export function sortSessions(sessions: readonly AccountSession[]): AccountSession[] {
  return [...sessions].sort(
    (left, right) =>
      Number(right.current) - Number(left.current) || lastSeen(right) - lastSeen(left),
  );
}
