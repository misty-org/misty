import { useSettingsStore } from "@/features/settings";
import { isIncognitoWindow } from "@/features/app-windows";
import { memoryApi } from "./api";
import { recallSettings } from "./recallSettings";
import { windowSpaceId } from "./windowSpace";

/** Before this local hour it is still last night, and the day isn't over. */
const MORNING_STARTS = 4;

const pad = (n: number) => String(n).padStart(2, "0");

/** A time's local calendar day, as YYYY-MM-DD. */
export function localDay(at: string | Date) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What this computer has done: the morning it last looked, and the last day it wrote a brief for. */
interface Seen {
  checked?: string;
  day?: string;
}

const seenKey = () => `misty.morning-brief.${windowSpaceId() ?? "personal"}`;

function readSeen(): Seen {
  try {
    return JSON.parse(localStorage.getItem(seenKey()) ?? "{}") as Seen;
  } catch {
    return {};
  }
}

function writeSeen(seen: Seen) {
  try {
    localStorage.setItem(seenKey(), JSON.stringify(seen));
  } catch {
    // Without storage the brief is still kept from repeating by the server's recap.
  }
}

/** The morning this run last tried, so a failure waits for the next launch, not the next focus. */
let attempted = "";

/**
 * Writes the recap of the last day with moments, once each morning, on this computer's fast model.
 * Answers with the day it wrote. A recap the person forgot stays forgotten, because a day this
 * computer already wrote is never written again.
 */
export async function writeMorningBrief(): Promise<string | null> {
  const document = useSettingsStore.getState().settings?.document;
  if (!document) return null;
  const settings = recallSettings(document);
  const now = new Date();
  if (
    !settings.enabled ||
    !settings.morningBrief ||
    settings.pausedUntil > now.getTime() ||
    isIncognitoWindow() ||
    now.getHours() < MORNING_STARTS
  )
    return null;
  const today = localDay(now);
  const seen = readSeen();
  if (attempted === today || seen.checked === today) return null;
  attempted = today;
  // Marked first, so a second window opening now doesn't write it too.
  writeSeen({ ...seen, checked: today });
  try {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { events } = await memoryApi.events({ to: midnight.toISOString(), limit: 1 });
    const latest = events[0];
    if (!latest) return null;
    const day = localDay(latest.occurred_at);
    if ((seen.day && seen.day >= day) || (await memoryApi.hasRecap(day))) return null;
    await memoryApi.daySummary({
      date: day,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    writeSeen({ checked: today, day });
    return day;
  } catch {
    // No model set up, or offline. The day's sites still show, and the next launch tries again.
    writeSeen(seen);
    return null;
  }
}
