import { useMemo } from "react";
import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preference_access";

const setting = "agents.companion.style";
const MOST = 5;
const LONGEST = 160;

export function tutorStyle(): string[] {
  const settings = useDevicePreferences.getState().state;
  if (!settings) return [];
  return parse(effectiveValues(settings)[setting]);
}

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

export function rememberTutorStyle(line: string) {
  const kept = line.replace(/\s+/g, " ").trim().slice(0, LONGEST);
  if (!kept) return Promise.resolve();
  const lines = tutorStyle().filter((item) => item.toLowerCase() !== kept.toLowerCase());
  return writeDevicePreference(setting, [...lines, kept].slice(-MOST).join("\n"));
}

export const forgetTutorStyle = () => writeDevicePreference(setting, "");
