import { invoke } from "@tauri-apps/api/core";

/** A site's own look: extra CSS (hidden elements included) and an optional dark mode. */
export interface SiteStyle {
  host: string;
  css: string;
  dark: boolean;
}

export function parseSiteStyles(raw: string): SiteStyle[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { host, css, dark } = entry as Record<string, unknown>;
      if (typeof host !== "string" || !host || host.length > 253) return [];
      return [
        {
          host: host.toLowerCase(),
          css: typeof css === "string" ? css.slice(0, 32_768) : "",
          dark: dark === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** The site a page's style is stored under: its host without `www.`. */
export function siteStyleHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The setting after one site's style changes; an empty style removes the site. */
export function siteStylesWith(raw: string, host: string, style: Omit<SiteStyle, "host">): string {
  const rest = parseSiteStyles(raw).filter((entry) => entry.host !== host);
  const keep = style.css.trim() || style.dark;
  return JSON.stringify(keep ? [...rest, { host, css: style.css, dark: style.dark }] : rest);
}

export const boostFonts = [
  { value: "", label: "Site default" },
  { value: "system-ui, sans-serif", label: "System sans" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif" },
  { value: "ui-monospace, Menlo, Consolas, monospace", label: "Monospace" },
];
export const boostSizes = [
  { value: "", label: "Site default" },
  { value: "90", label: "Smaller" },
  { value: "112", label: "Larger" },
  { value: "125", label: "Largest" },
];

const boostStart = "/* misty-boost */";
const boostEnd = "/* end misty-boost */";
const boostBlock = /\/\* misty-boost \*\/[\s\S]*?\/\* end misty-boost \*\/\n?/;

/** A site's font and text size, kept in a marked block at the top of its CSS. */
export interface Boost {
  font: string;
  size: string;
}

export function readBoost(css: string): Boost {
  const block = css.match(boostBlock)?.[0] ?? "";
  const font = boostFonts.find((option) => option.value && block.includes(`font-family: ${option.value} `));
  const size = boostSizes.find((option) => option.value && block.includes(`font-size: ${option.value}%`));
  return { font: font?.value ?? "", size: size?.value ?? "" };
}

/** Replaces the font and size block, leaving the rest of the CSS as the person wrote it. */
export function withBoost(css: string, boost: Boost): string {
  const rest = css.replace(boostBlock, "");
  const rules = [
    boost.font ? `  font-family: ${boost.font} !important;` : "",
    boost.size ? `  font-size: ${boost.size}% !important;` : "",
  ].filter(Boolean);
  if (!rules.length) return rest;
  const block = [boostStart, "html, body {", ...rules, "}", boostEnd, ""].join("\n");
  return `${block}${rest}`;
}

let pushed: string | null = null;

/** Sends the account's site styles to the native browser, which applies them per page. */
export function configureBrowserSiteStyles(raw: string): void {
  const sites = parseSiteStyles(raw);
  const signature = JSON.stringify(sites);
  if (signature === pushed) return;
  pushed = signature;
  void invoke<void>("browser_set_site_styles", { sites }).catch(() => {
    pushed = null;
  });
}
