import { useMemo } from "react";
import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preferenceAccess";

/**
 * How the person asked Tutor to answer ("simpler please", "more drawings"), kept on this device
 * (Settings › Tutor) and told to every session, so it holds from one day to the next. A few short
 * lines, newest last; asking again for the same thing doesn't repeat it.
 */
const setting = "agents.companion.style";
const MOST = 5;
const LONGEST = 160;

/** What Tutor keeps to now. */
export function tutorStyle(): string[] {
  const settings = useDevicePreferences.getState().state;
  if (!settings) return [];
  return parse(effectiveValues(settings)[setting]);
}

/** The same, for a page that shows it. The store gives the saved text; it is split here. */
export function useTutorStyle(): string[] {
  const saved = useDevicePreferences((store) =>
    store.state ? String(effectiveValues(store.state)[setting] ?? "") : "",
  );
  return useMemo(() => parse(saved), [saved]);
}

function parse(value: unknown): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Keeps one more way to answer; the oldest go once there are more than a few. */
export function rememberTutorStyle(line: string) {
  const kept = line.replace(/\s+/g, " ").trim().slice(0, LONGEST);
  if (!kept) return Promise.resolve();
  const lines = tutorStyle().filter((item) => item.toLowerCase() !== kept.toLowerCase());
  return writeDevicePreference(setting, [...lines, kept].slice(-MOST).join("\n"));
}

/** Goes back to how Tutor answered before anything was asked. */
export const forgetTutorStyle = () => writeDevicePreference(setting, "");
