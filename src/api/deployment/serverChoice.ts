import { invoke } from "@/native/invoke";
import { create } from "zustand";
import { isAllowedServerUrl, normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base-url";

/**
 * Which Misty server this device uses, chosen before signing in or in Settings and kept in this
 * device's settings (`misty.db`; settings never sync). With none, Misty is the browser only and
 * signed out. Until someone chooses, a development build's requests fall back to
 * `VITE_MISTY_PUBLIC_API_URL`, or the local dev stack; the sign-in pages still ask, with that
 * address filled in.
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

/**
 * Misty's own server, which a device only uses once someone chooses Misty Pro. An account's
 * credential derives from this address, so it matches the website's in each kind of build.
 */
export function mistyProServer(): string {
  return import.meta.env.DEV ? "https://dev-api.mistysys.com/v1" : "https://api.mistysys.com/v1";
}

/** Misty's website, in each kind of build. */
export function mistyWebsite(): string {
  return import.meta.env.DEV ? "http://localhost:5176" : "https://mistysys.com";
}

/** The API base a choice means: its server's, "" for browsing only, or the development default. */
function apiBaseFor(choice: ServerChoice | null): string {
  if (!choice) return developmentServer();
  return choice.mode === "server" ? choice.url : "";
}

function isChoice(value: unknown): value is ServerChoice {
  if (!value || typeof value !== "object") return false;
  const choice = value as { mode?: unknown; url?: unknown };
  if (choice.mode === "none") return true;
  // A server saved before the https rule counts as no choice, so the wizard asks again.
  return (
    choice.mode === "server" && typeof choice.url === "string" && isAllowedServerUrl(choice.url)
  );
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
const snapshot = () => invoke<Snapshot>("settings_session_state", { scope });

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
      await invoke("settings_session_commit", { scope, revision, document });
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
