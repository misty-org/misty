import { Puzzle } from "lucide-react";
import type { CatalogEntry } from "./types";

export function plainDescription(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}

export function ExtensionIcon({ entry }: { entry?: Pick<CatalogEntry, "iconUrl"> }) {
  return entry?.iconUrl.startsWith("https://") ? (
    <img
      src={entry.iconUrl}
      alt=""
      className="size-5 object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <Puzzle size={18} aria-hidden="true" />
  );
}
