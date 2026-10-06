import { Globe } from "lucide-react";
import { BrandIcon } from "@/shared/ui";
import type { ImportBrowser } from "./native";

const brands: Partial<Record<ImportBrowser, string>> = {
  chrome: "chrome",
  edge: "microsoft-edge",
  brave: "brave",
  arc: "arc",
  vivaldi: "vivaldi",
  opera: "opera",
  chromium: "chromium",
  firefox: "firefox",
  safari: "safari",
};

/** The browser's own artwork, never recolored (see the brand icon README).
 * Browsers without artwork in the registry (Zen) show a monochrome globe. */
export function BrowserLogo({ browser, size = 24 }: { browser: ImportBrowser; size?: number }) {
  const brand = brands[browser];
  if (!brand) return <Globe size={size * 0.75} className="text-cream-muted" aria-hidden />;
  return <BrandIcon brand={brand} size={size} aria-hidden />;
}
