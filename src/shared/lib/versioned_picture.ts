import { useEffect, useRef, useState } from "react";
import { decodedPictureUrl, usePicturePreview } from "./picture_previews";

const loading = new Map<string, Promise<string | null>>();
const ready = new Map<string, string | null>();
const newest = new Map<string, number>();

function cacheKey(key: string, version: number) {
  return `${key}:${version}`;
}

function settle(key: string, version: number, url: string | null) {
  ready.set(cacheKey(key, version), url);
  if (version <= (newest.get(key) ?? 0)) return;
  newest.set(key, version);
  const prefix = `${key}:`;
  for (const [at, older] of ready) {
    if (!at.startsWith(prefix) || at === cacheKey(key, version)) continue;
    if (Number(at.slice(prefix.length)) >= version) continue;
    if (older && older !== url) URL.revokeObjectURL(older);
    ready.delete(at);
    loading.delete(at);
  }
}

export function seedPicture(key: string, version: number, url: string) {
  loading.set(cacheKey(key, version), Promise.resolve(url));
  settle(key, version, url);
}

export function readyPicture(key: string, version: number): string | null | undefined {
  return version ? ready.get(cacheKey(key, version)) : null;
}

export function pictureFor(
  key: string,
  version: number,
  load: () => Promise<Blob>,
): Promise<string | null> {
  if (!version) return Promise.resolve(null);
  const at = cacheKey(key, version);
  let picture = loading.get(at);
  if (!picture) {
    picture = load()
      .then((blob) => (blob.size ? decodedPictureUrl(blob) : null))
      .then((url) => {
        settle(key, version, url);
        return url;
      })
      .catch(() => {
        loading.delete(at);
        return null;
      });
    loading.set(at, picture);
  }
  return picture;
}

export function useVersionedPicture(
  key: string,
  version: number,
  load: () => Promise<Blob>,
): string | null {
  const preview = usePicturePreview(key);
  const loader = useRef(load);
  loader.current = load;
  const [shown, setShown] = useState<{ key: string; url: string | null }>(() => ({
    key,
    url: readyPicture(key, version) ?? null,
  }));
  useEffect(() => {
    const known = readyPicture(key, version);
    if (known !== undefined) {
      setShown({ key, url: known });
      return;
    }
    let live = true;
    void pictureFor(key, version, () => loader.current()).then((url) => {
      if (live) setShown({ key, url });
    });
    return () => {
      live = false;
    };
  }, [key, version]);
  return preview ?? (shown.key === key ? shown.url : null);
}
