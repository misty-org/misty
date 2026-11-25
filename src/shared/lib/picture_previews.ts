import { useSyncExternalStore } from "react";

let previews: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function decodedPictureUrl(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  if (typeof image.decode === "function") await image.decode().catch(() => undefined);
  return url;
}

export function showPicturePreview(key: string, url: string | null) {
  const next = new Map(previews);
  if (url) next.set(key, url);
  else next.delete(key);
  previews = next;
  for (const listener of listeners) listener();
}

export function usePicturePreview(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => previews.get(key) ?? null,
    () => null,
  );
}

export function usePicturePreviews(): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => previews,
    () => previews,
  );
}
