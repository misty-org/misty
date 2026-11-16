import { useEffect, useState } from "react";
import { accountFetchAvatar } from "@/features/account";
import { spacesApi } from "../api/api";

/**
 * Members' profile pictures, fetched once per picture version for this session: an object URL, or
 * null when it couldn't be had (their initial shows instead). A member with no picture (version 0)
 * is never asked for.
 */
const pictures = new Map<string, Promise<string | null>>();

export function memberPicture(spaceId: string, userId: string, version: number) {
  if (!version) return Promise.resolve(null);
  const key = `${spaceId}:${userId}:${version}`;
  let picture = pictures.get(key);
  if (!picture) {
    picture = spacesApi
      .memberAvatar(spaceId, userId)
      .then((blob) => (blob.size ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    pictures.set(key, picture);
  }
  return picture;
}

/**
 * The person's own profile picture, from their account, so their face is theirs on every page
 * even before a Space has their picture. Fetched once per picture version, like a member's.
 */
export function myPicture(version: number) {
  if (!version) return Promise.resolve(null);
  const key = `me:${version}`;
  let picture = pictures.get(key);
  if (!picture) {
    picture = accountFetchAvatar()
      .then((blob) => (blob.size ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    pictures.set(key, picture);
  }
  return picture;
}

/** A member's profile picture, while it loads and when they have none: null. */
export function useMemberPicture(spaceId: string, userId: string, version = 0) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!version) return;
    let live = true;
    void memberPicture(spaceId, userId, version).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [spaceId, userId, version]);
  return url;
}
