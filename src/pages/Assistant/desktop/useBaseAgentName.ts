import { useCallback, useSyncExternalStore } from "react";

/**
 * The base chat isn't a stored agent, but we present it as one. Its display name is
 * user-customisable and persisted locally so both the panel and the header stay in sync.
 */
const STORAGE_KEY = "misty.baseAgentName";
const DEFAULT_NAME = "Assistant";
const EVENT = "misty:base-agent-name";

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useBaseAgentName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, read, () => DEFAULT_NAME);
  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    try {
      if (trimmed && trimmed !== DEFAULT_NAME) localStorage.setItem(STORAGE_KEY, trimmed);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Persistence is best-effort; the UI still updates via the event below.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [name, setName];
}
