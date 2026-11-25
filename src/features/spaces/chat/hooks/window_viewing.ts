import { useSyncExternalStore } from "react";

export function isWindowViewing(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function subscribe(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  };
}

const shownChats = new Map<string, number>();

function chatKey(spaceId: string, conversationId: string): string {
  return `${spaceId}/${conversationId || "everyone"}`;
}

export function showChat(spaceId: string, conversationId: string): () => void {
  const key = chatKey(spaceId, conversationId);
  shownChats.set(key, (shownChats.get(key) ?? 0) + 1);
  return () => {
    const left = (shownChats.get(key) ?? 1) - 1;
    if (left > 0) shownChats.set(key, left);
    else shownChats.delete(key);
  };
}

export function isChatOnScreen(spaceId: string, conversationId: string): boolean {
  return isWindowViewing() && shownChats.has(chatKey(spaceId, conversationId));
}

export function useWindowViewing(): boolean {
  return useSyncExternalStore(subscribe, isWindowViewing, () => true);
}
