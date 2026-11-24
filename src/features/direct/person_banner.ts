import { useEffect, useState } from "react";
import { directApi } from "./api";

const banners = new Map<string, Promise<string | null>>();

function personBanner(userId: string, version: number) {
  const key = `${userId}:${version}`;
  let banner = banners.get(key);
  if (!banner) {
    banner = directApi
      .personBanner(userId)
      .then((blob) => (blob.size ? URL.createObjectURL(blob) : null))
      .catch(() => {
        banners.delete(key);
        return null;
      });
    banners.set(key, banner);
  }
  return banner;
}

export function usePersonBanner(userId: string, version = 0) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!version) return;
    let live = true;
    void personBanner(userId, version).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [userId, version]);
  return url;
}
