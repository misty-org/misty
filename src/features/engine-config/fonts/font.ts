// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { invoke } from "@/native/invoke";

export interface FontPreferences {
  fontFamily: string;
  codeFontFamily: string;
  fontFile: string;
  codeFontFile: string;
}

export const emptyFontPreferences: FontPreferences = {
  fontFamily: "",
  codeFontFamily: "",
  fontFile: "",
  codeFontFile: "",
};

const FONT_CHANGE_EVENT = "misty:font-change";

export const CUSTOM_FONT_VALUE = "custom";

const UI_SYSTEM_STACK =
  '"Inter Variable", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
const CODE_SYSTEM_STACK = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const CUSTOM_UI_FONT_FAMILY = "Misty Custom UI Font";
export const CUSTOM_CODE_FONT_FAMILY = "Misty Custom Code Font";

type CustomFontRole = "ui" | "code";
export type FontField = "fontFamily" | "codeFontFamily";

const CACHE_KEY = "misty.fonts:v1";

function normalizeFontFamily(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function isValidFontFamily(value: string): boolean {
  const family = normalizeFontFamily(value);
  if (!family || family === "system" || family === CUSTOM_FONT_VALUE) return true;
  // eslint-disable-next-line no-control-regex
  if (/[;{}()\u0000-\u001f\u007f]/.test(family) || family.includes("/*")) return false;
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(family)) return false;
  if (typeof document === "undefined") return true;
  const style = document.createElement("span").style;
  style.fontFamily = family;
  return style.fontFamily !== "";
}

export function normalizeFontMode(value: string | null | undefined): string {
  const family = normalizeFontFamily(value);
  return family === "system" || !isValidFontFamily(family) ? "" : family;
}

export function fontRole(field: FontField): CustomFontRole {
  return field === "fontFamily" ? "ui" : "code";
}

function customFontFamily(role: CustomFontRole): string {
  return role === "ui" ? CUSTOM_UI_FONT_FAMILY : CUSTOM_CODE_FONT_FAMILY;
}

export function uiFontStack(pref: string): string | null {
  return fontStack(pref, CUSTOM_UI_FONT_FAMILY, UI_SYSTEM_STACK);
}

export function codeFontStack(pref: string): string | null {
  return fontStack(pref, CUSTOM_CODE_FONT_FAMILY, CODE_SYSTEM_STACK);
}

function fontStack(pref: string, customFamily: string, fallback: string): string | null {
  const family = normalizeFontMode(pref);
  if (!family) return null;
  return `${family === CUSTOM_FONT_VALUE ? JSON.stringify(customFamily) : family}, ${fallback}`;
}

export function readCache(): FontPreferences | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw
      ? { ...emptyFontPreferences, ...(JSON.parse(raw) as Partial<FontPreferences>) }
      : null;
  } catch {
    return null;
  }
}

function writeCache(prefs: FontPreferences) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function applyFontPreferences(prefs: FontPreferences): void {
  const fontFamily = normalizeFontMode(prefs.fontFamily);
  const codeFontFamily = normalizeFontMode(prefs.codeFontFamily);
  const style = document.documentElement.style;
  const uiStack = uiFontStack(fontFamily);
  const codeStack = codeFontStack(codeFontFamily);
  if (uiStack === null) style.removeProperty("--font-sans");
  else style.setProperty("--font-sans", uiStack);
  if (codeStack === null) style.removeProperty("--font-mono");
  else style.setProperty("--font-mono", codeStack);
  writeCache({
    fontFamily,
    codeFontFamily,
    fontFile: normalizeFontFamily(prefs.fontFile),
    codeFontFile: normalizeFontFamily(prefs.codeFontFile),
  });
  if (fontFamily === CUSTOM_FONT_VALUE) {
    void ensureCustomFontLoaded("ui", prefs.fontFile).catch(() => {});
  }
  if (codeFontFamily === CUSTOM_FONT_VALUE) {
    void ensureCustomFontLoaded("code", prefs.codeFontFile).catch(() => {});
  }
  window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
}

export const loadFontPreferences = () => invoke<FontPreferences>("engine_fonts_get");

export const saveFontPreferences = (preferences: FontPreferences) =>
  invoke<FontPreferences>("engine_fonts_set", { preferences });

export const pickFontFile = (role: CustomFontRole) =>
  invoke<string | null>("engine_fonts_pick", { role });

export async function applySavedFonts(): Promise<void> {
  const cached = readCache();
  if (cached) applyFontPreferences(cached);
  try {
    applyFontPreferences(await loadFontPreferences());
  } catch {}
}

const registeredFaces = new Map<CustomFontRole, FontFace>();
const fontLoads = new Map<CustomFontRole, { path: string; promise: Promise<void> }>();
const fontLoadVersions = new Map<CustomFontRole, number>();

export function ensureCustomFontLoaded(
  role: CustomFontRole,
  path: string,
  options?: { force?: boolean },
): Promise<void> {
  const value = normalizeFontFamily(path);
  if (!value) return Promise.resolve();
  const cached = fontLoads.get(role);
  if (!options?.force && cached?.path === value) return cached.promise;
  const version = (fontLoadVersions.get(role) ?? 0) + 1;
  fontLoadVersions.set(role, version);
  const promise = loadCustomFont(role, value, version);
  promise.catch(() => {});
  fontLoads.set(role, { path: value, promise });
  return promise;
}

async function loadCustomFont(role: CustomFontRole, path: string, version: number): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const encoded = await invoke<string>("engine_fonts_read", { path });
  const face = new FontFace(customFontFamily(role), decodeBase64(encoded));
  let loaded: FontFace;
  try {
    loaded = await face.load();
  } catch {
    throw new Error("font.err.unsupported");
  }
  if (fontLoadVersions.get(role) !== version) return;
  const previous = registeredFaces.get(role);
  if (previous) document.fonts.delete(previous);
  document.fonts.add(loaded);
  registeredFaces.set(role, loaded);
  window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const FONT_ERRORS: Record<string, string> = {
  "font.err.read_failed": "The font file couldn't be read. Make sure it still exists.",
  "font.err.too_large": "The font file is too large (64 MB at most).",
  "font.err.unsupported": "Choose a TTF, OTF, TTC, WOFF or WOFF2 font file.",
};

export function fontErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return FONT_ERRORS[raw.trim()] ?? raw;
}
