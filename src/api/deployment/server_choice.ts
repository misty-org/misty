import { invoke } from "@/native/invoke";
import { create } from "zustand";
import { isAllowedServerUrl, normalizeApiBaseUrl, withDefaultApiPath } from "@/api/client/base_url";

export type ServerChoice = { mode: "server"; url: string } | { mode: "none" };

interface StoredChoice {
  version: 1;
  choice: ServerChoice;
}

const scope = "device:server";
const channelName = "misty:server-choice";

export function developmentServer(): string {
  if (!import.meta.env.DEV) return "";
  const base =
    normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL) ?? "http://127.0.0.1:8081/v1";
  return withDefaultApiPath(base);
}

export function mistyCloudServer(): string {
  return import.meta.env.DEV ? "https://dev-api.mistysys.com/v1" : "https://api.mistysys.com/v1";
}

export function mistyWebsite(): string {
  return import.meta.env.DEV ? "http://localhost:5176" : "https://mistysys.com";
}

function apiBaseFor(choice: ServerChoice | null): string {
  if (!choice) return developmentServer();
  return choice.mode === "server" ? choice.url : "";
}

export function isMistyCloud(choice: ServerChoice | null): boolean {
  return apiBaseFor(choice) === mistyCloudServer();
}

function isChoice(value: unknown): value is ServerChoice {
  if (!value || typeof value !== "object") return false;
  const choice = value as { mode?: unknown; url?: unknown };
  if (choice.mode === "none") return true;
  return (
    choice.mode === "server" && typeof choice.url === "string" && isAllowedServerUrl(choice.url)
  );
}

interface ServerChoiceState {
  loaded: boolean;
  choice: ServerChoice | null;
}

export const useServerChoice = create<ServerChoiceState>(() => ({ loaded: false, choice: null }));

let loading: Promise<ServerChoice | null> | null = null;
let channel: BroadcastChannel | null = null;

interface Snapshot {
  revision: number;
  state: StoredChoice | null;
}

const snapshot = () => invoke<Snapshot>("settings_session_state", { scope });

async function read(): Promise<ServerChoice | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const saved = await snapshot();
      return isChoice(saved.state?.choice) ? saved.state.choice : null;
    } catch {
      if (attempt >= 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function listen() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(channelName);
  channel.onmessage = () => {
    void read().then((choice) => useServerChoice.setState({ loaded: true, choice }));
  };
}

export function loadServerChoice(): Promise<ServerChoice | null> {
  listen();
  loading ??= read().then((choice) => {
    useServerChoice.setState({ loaded: true, choice });
    return choice;
  });
  return loading;
}

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

export function currentApiBase(): string {
  return apiBaseFor(useServerChoice.getState().choice);
}
