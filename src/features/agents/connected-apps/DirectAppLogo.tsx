import { useEffect, useState } from "react";
import { LogoInitial, Mark, markFor } from "@misty/ui";
import { directAppsApi } from "./direct_api";

const logos = new Map<string, string | null>();
const waiting = new Map<string, Promise<string | null>>();

function logoOf(url: string): Promise<string | null> {
  const known = logos.get(url);
  if (known !== undefined) return Promise.resolve(known);
  let pending = waiting.get(url);
  if (!pending) {
    pending = directAppsApi
      .icon(url)
      .catch(() => null)
      .then((found) => {
        logos.set(url, found);
        waiting.delete(url);
        return found;
      });
    waiting.set(url, pending);
  }
  return pending;
}

export function DirectAppLogo({
  app,
  name,
  icon,
  size = 18,
}: {
  app: string;
  name: string;
  icon?: string;
  size?: number;
}) {
  const brand = Boolean(markFor(app));
  const [src, setSrc] = useState<string | null>(() => (icon ? (logos.get(icon) ?? null) : null));
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    if (brand || !icon) return;
    let live = true;
    void logoOf(icon).then((found) => live && setSrc(found));
    return () => {
      live = false;
    };
  }, [brand, icon]);
  if (brand) return <Mark of={app} size={size} />;
  if (src && broken !== src)
    return (
      <img
        src={src}
        onError={() => setBroken(src)}
        alt=""
        width={size}
        height={size}
        className="rounded-sm object-contain"
        draggable={false}
      />
    );
  return <LogoInitial name={name || app} size={size} />;
}
