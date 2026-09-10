import { Puzzle } from "lucide-react";
import type { CatalogEntry } from "./types";

/** Store icons load over HTTPS; Chrome packages carry their own PNG icon. */
const iconSource = (url = "") =>
  url.startsWith("https://") || url.startsWith("data:image/png;base64,") ? url : null;

export function ExtensionIcon({ entry }: { entry?: Pick<CatalogEntry, "iconUrl"> }) {
  const source = iconSource(entry?.iconUrl);
  return source ? (
    <img
      src={source}
      alt=""
      className="size-5 object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <Puzzle size={18} aria-hidden="true" />
  );
}
