import { useEffect, useState, type CSSProperties } from "react";
import { spacesApi } from "../api/api";
import type { Space } from "../api/dto/entities";
import { Avatar, AvatarFallback, AvatarImage, cn } from "@misty/ui";

const pictures = new Map<string, Promise<string | null>>();

function spacePicture(spaceId: string, version: number) {
  const key = `${spaceId}:${version}`;
  let picture = pictures.get(key);
  if (!picture) {
    picture = spacesApi
      .spacePicture(spaceId)
      .then((blob) => (blob.size ? URL.createObjectURL(blob) : null))
      .catch(() => null);
    pictures.set(key, picture);
  }
  return picture;
}

function useSpacePicture(spaceId: string, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!version) return;
    let live = true;
    void spacePicture(spaceId, version).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [spaceId, version]);
  return url;
}

const tones = ["blue", "teal", "violet", "orange", "pink", "green", "amber", "red"] as const;

export function spaceTone(id: string): (typeof tones)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length];
}

export function SpaceAvatar({
  space,
  className,
  fallbackClassName,
}: {
  space: Pick<Space, "id" | "name"> & Partial<Pick<Space, "avatar_version">>;
  className?: string;
  fallbackClassName?: string;
}) {
  const picture = useSpacePicture(space.id, space.avatar_version ?? 0);
  const tone = `var(--color-tone-${spaceTone(space.id)})`;
  const style: CSSProperties = {
    background: `linear-gradient(140deg, color-mix(in srgb, ${tone} 88%, white), color-mix(in srgb, ${tone} 62%, black))`,
  };
  return (
    <Avatar shape="tile" className={cn("shrink-0", className)} aria-label={`${space.name} picture`}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback
        className={cn("font-semibold tracking-tight text-white", fallbackClassName)}
        style={style}
      >
        {spaceInitials(space.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function spaceInitials(name: string): string {
  const words = name
    .trim()
    .replace(/['’]s\b/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
}
