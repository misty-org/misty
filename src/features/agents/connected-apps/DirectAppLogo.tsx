import { useEffect, useState } from "react";
import { BrandIcon, LogoInitial, brandIconAsset } from "@/shared/ui";
import { directAppsApi } from "./directApi";

/** Logos fetched this session, by address; null when one couldn't be had. */
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

/**
 * An app's official logo: Misty's own artwork of the brand when it has one, else the logo the
 * maker (or Composio, for its apps) published, which native code fetches once and keeps; the app's initial until then, and
 * if the image turns out not to draw.
 */
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
  const brand = Boolean(brandIconAsset(app));
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
  if (brand) return <BrandIcon brand={app} size={size} />;
  if (src && broken !== src)
    return (
      <img
        src={src}
        onError={() => setBroken(src)}
        alt=""
        width={size}
        height={size}
        className="rounded-[4px] object-contain"
        draggable={false}
      />
    );
  return <LogoInitial name={name || app} size={size} />;
}
