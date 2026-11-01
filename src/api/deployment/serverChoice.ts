import { invoke } from "@/native/invoke";
import { create } from "zustand";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base-url";

/**
 * Which Misty server this device uses, chosen in the setup wizard and kept in this device's
 * settings (`misty.db`; settings never sync). With none, Misty is the browser only and signed
 * out. A development build falls back to `VITE_MISTY_PUBLIC_API_URL`, or the local dev stack,
 * until someone chooses.
 */
export type ServerChoice = { mode: "server"; url: string } | { mode: "none" };

interface StoredChoice {
  version: 1;
  choice: ServerChoice;
}

const scope = "device:server";
const channelName = "misty:server-choice";

/** The development default, or "" in a release build. */
export function developmentServer(): string {
  if (!import.meta.env.DEV) return "";
  const base =
    normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL) ??
    // compose.dev.yml publishes the Go API on loopback port 8081.
    "http://127.0.0.1:8081/v1";
  return withDefaultApiPath(base);
}

/** The API base a choice means: its server's, "" for browsing only, or the development default. */
export function apiBaseFor(choice: ServerChoice | null): string {
  if (!choice) return developmentServer();
  return choice.mode === "server" ? choice.url : "";
}

function isChoice(value: unknown): value is ServerChoice {
  if (!value || typeof value !== "object") return false;
  const choice = value as { mode?: unknown; url?: unknown };
  return choice.mode === "none" || (choice.mode === "server" && typeof choice.url === "string");
}

interface ServerChoiceState {
  /** False until this device's choice has been read. */
  loaded: boolean;
  /** Null when nobody has chosen yet on this device. */
  choice: ServerChoice | null;
}

export const useServerChoice = create<ServerChoiceState>(() => ({ loaded: false, choice: null }));

let loading: Promise<ServerChoice | null> | null = null;
let channel: BroadcastChannel | null = null;

interface Snapshot {
  revision: number;
  state: StoredChoice | null;
}

// The same `settings_state` rows the device preferences use, in a scope of their own.
const snapshot = () => invoke<Snapshot>("settings_profile_state", { scope });

async function read(): Promise<ServerChoice | null> {
  try {
    const saved = await snapshot();
    return isChoice(saved.state?.choice) ? saved.state.choice : null;
  } catch {
    return null;
  }
}

function listen() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(channelName);
  // Another window chose a server: every window talks to the same one.
  channel.onmessage = () => {
    void read().then((choice) => useServerChoice.setState({ loaded: true, choice }));
  };
}

/** Reads this device's choice once; later calls reuse it. */
export function loadServerChoice(): Promise<ServerChoice | null> {
  listen();
  loading ??= read().then((choice) => {
    useServerChoice.setState({ loaded: true, choice });
    return choice;
  });
  return loading;
}

/** Saves the choice on this device and tells the other windows. Signing out of the old server
 * is the caller's part (see `useChangeServer`). */
export async function saveServerChoice(choice: ServerChoice): Promise<void> {
  const document: StoredChoice = { version: 1, choice };
  for (let attempt = 0; ; attempt++) {
    const { revision } = await snapshot();
    try {
      await invoke("settings_profile_commit", { scope, revision, document });
      break;
    } catch (error) {
      if (attempt >= 5 || !String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
  loading = Promise.resolve(choice);
  useServerChoice.setState({ loaded: true, choice });
  channel?.postMessage("changed");
}

/** The API base in use now. Before the first read it is the development default. */
export function currentApiBase(): string {
  return apiBaseFor(useServerChoice.getState().choice);
}
