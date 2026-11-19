import { realtimeDeckEvent } from "./session";

const deckListChangedEvent = "misty:space-decks-changed";

export function notifyDeckListChanged(spaceId: string): void {
  window.dispatchEvent(new CustomEvent(deckListChangedEvent, { detail: { spaceId } }));
}

/** Calls `listener` when this window changed a Space's decks, or the server says one changed. */
export function subscribeToDeckListChanges(spaceId: string, listener: () => void): () => void {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ spaceId?: string }>).detail;
    if (detail?.spaceId === spaceId) listener();
  };
  const handleRealtime = (event: Event) => {
    const detail = (event as CustomEvent<{ space_id?: string }>).detail;
    if (detail?.space_id === spaceId) listener();
  };
  window.addEventListener(deckListChangedEvent, handle);
  window.addEventListener(realtimeDeckEvent, handleRealtime);
  return () => {
    window.removeEventListener(deckListChangedEvent, handle);
    window.removeEventListener(realtimeDeckEvent, handleRealtime);
  };
}
