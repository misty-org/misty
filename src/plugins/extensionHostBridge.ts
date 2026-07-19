import { themeBaseMode, useAppThemeStore } from "../stores/useAppThemeStore";
import type { MistyCustomThemeTokens, MistyThemeId } from "../stores/useAppThemeStore";

export type SemanticThemeToken =
  | "background" | "surface" | "surfaceRaised" | "surfaceHover" | "border" | "borderStrong"
  | "text" | "textMuted" | "textSubtle" | "primary" | "primaryContrast" | "accent" | "focus"
  | "selection" | "success" | "warning" | "danger" | "info" | "shadow";
export type ThemeSnapshot = { themeId: string; mode: "dark" | "light"; revision: number; tokens: Record<SemanticThemeToken, string> };

const customTokenProperties = {
  background: "--misty-bg", surface: "--misty-surface", foreground: "--misty-text",
  muted: "--misty-text-muted", accent: "--misty-accent", selection: "--misty-selection",
  success: "--misty-success", warning: "--misty-warning", danger: "--misty-danger",
} as const;
const semanticTokenProperties: Record<SemanticThemeToken, string> = {
  background: "--misty-bg", surface: "--misty-surface", surfaceRaised: "--misty-surface-2",
  surfaceHover: "--misty-surface-hover", border: "--misty-border", borderStrong: "--misty-border-strong",
  text: "--misty-text", textMuted: "--misty-text-muted", textSubtle: "--misty-text-subtle",
  primary: "--misty-primary", primaryContrast: "--misty-primary-contrast", accent: "--misty-accent",
  focus: "--misty-interaction-focus", selection: "--misty-selection", success: "--misty-success",
  warning: "--misty-warning", danger: "--misty-danger", info: "--misty-info", shadow: "--misty-shadow",
};
let themeRevision = 1;
export function advanceThemeRevision() { themeRevision += 1; }

export function themeSnapshot(): ThemeSnapshot {
  const state = useAppThemeStore.getState();
  const styles = getComputedStyle(document.documentElement);
  return {
    themeId: state.themeId,
    mode: state.resolvedTheme,
    revision: themeRevision,
    tokens: Object.fromEntries(Object.entries(semanticTokenProperties).map(([token, property]) => [token, styles.getPropertyValue(property).trim()])) as Record<SemanticThemeToken, string>,
  };
}

export function readEditableThemeTokens(): MistyCustomThemeTokens {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(customTokenProperties).map(([token, property]) => [token, styles.getPropertyValue(property).trim()])) as MistyCustomThemeTokens;
}

export function applyThemeTokenPreview(tokens: MistyCustomThemeTokens | null) {
  const root = document.documentElement;
  for (const [token, property] of Object.entries(customTokenProperties)) {
    const value = tokens?.[token as keyof MistyCustomThemeTokens];
    if (value) root.style.setProperty(property, value); else root.style.removeProperty(property);
  }
  const derived: Record<keyof MistyCustomThemeTokens, Record<string, string>> = {
    background: { "--misty-page-bg": tokens?.background ?? "", "--misty-nav-bg": tokens?.background ?? "", "--misty-bg-soft": tokens?.background ? `color-mix(in srgb, ${tokens.background} 92%, var(--misty-text) 8%)` : "" },
    surface: { "--misty-surface-2": tokens?.surface ? `color-mix(in srgb, ${tokens.surface} 91%, var(--misty-text) 9%)` : "", "--misty-surface-3": tokens?.surface ? `color-mix(in srgb, ${tokens.surface} 84%, var(--misty-text) 16%)` : "", "--misty-surface-hover": tokens?.surface ? `color-mix(in srgb, ${tokens.surface} 82%, var(--misty-text) 18%)` : "", "--misty-dropdown-bg": tokens?.surface ?? "" },
    foreground: { "--misty-primary": tokens?.foreground ?? "" },
    muted: { "--misty-text-subtle": tokens?.muted ? `color-mix(in srgb, ${tokens.muted} 72%, var(--misty-bg) 28%)` : "" },
    accent: { "--misty-accent-strong": tokens?.accent ?? "", "--misty-interaction-focus": tokens?.accent ? `color-mix(in srgb, ${tokens.accent} 78%, transparent)` : "", "--misty-focus-ring": tokens?.accent ? `color-mix(in srgb, ${tokens.accent} 24%, transparent)` : "" },
    selection: {}, success: {}, warning: {}, danger: {},
  };
  Object.values(derived).forEach((properties) => Object.entries(properties).forEach(([property, value]) => value ? root.style.setProperty(property, value) : root.style.removeProperty(property)));
  advanceThemeRevision();
}

function safeThemeTokens(value: unknown): MistyCustomThemeTokens | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: MistyCustomThemeTokens = {};
  for (const token of Object.keys(customTokenProperties) as Array<keyof MistyCustomThemeTokens>) {
    const color = (value as Record<string, unknown>)[token];
    if (color === undefined) continue;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    result[token] = color.toUpperCase();
  }
  return Object.keys(result).length ? result : null;
}
const isThemeId = (value: unknown): value is MistyThemeId => value === "misty-dark" || value === "misty-light" || value === "graphite" || value === "aurora" || value === "copper";

export async function handleSharedExtensionCommand(command: string, payload: Record<string, unknown>): Promise<unknown | undefined> {
  const store = useAppThemeStore.getState();
  if (command === "themes.snapshot") return { ok: true, themeId: store.themeId, theme: themeSnapshot(), tokens: store.customTokens ?? readEditableThemeTokens() };
  if (command === "themes.applyPreset") {
    if (!isThemeId(payload.preset)) throw new Error("Unsupported theme preset.");
    const root = document.documentElement;
    const resolvedTheme = themeBaseMode(payload.preset);
    root.dataset.theme = resolvedTheme; root.dataset.mistyTheme = payload.preset; root.style.colorScheme = resolvedTheme;
    root.classList.toggle("dark", resolvedTheme === "dark");
    applyThemeTokenPreview(null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { ok: true, tokens: readEditableThemeTokens(), theme: themeSnapshot() };
  }
  if (command === "themes.preview") {
    const tokens = safeThemeTokens(payload.tokens); if (!tokens) throw new Error("Theme tokens are invalid.");
    applyThemeTokenPreview(tokens); return { ok: true, tokens, theme: themeSnapshot(), message: "Preview updated. Apply to keep these colors." };
  }
  if (command === "themes.apply") {
    if (!isThemeId(payload.preset)) throw new Error("Unsupported theme preset.");
    const tokens = safeThemeTokens(payload.tokens); if (!tokens) throw new Error("Theme tokens are invalid.");
    store.setThemeMode(themeBaseMode(payload.preset)); store.setThemeId(payload.preset); store.setCustomTokens(tokens); applyThemeTokenPreview(tokens);
    return { ok: true, tokens, theme: themeSnapshot(), message: "Theme saved and applied across Misty." };
  }
  if (command === "themes.revert") {
    const current = useAppThemeStore.getState(); const root = document.documentElement;
    root.dataset.theme = current.resolvedTheme; root.dataset.mistyTheme = current.themeId; root.style.colorScheme = current.resolvedTheme;
    root.classList.toggle("dark", current.resolvedTheme === "dark");
    applyThemeTokenPreview(current.customTokens); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { ok: true, tokens: current.customTokens ?? readEditableThemeTokens(), theme: themeSnapshot(), message: "Reverted to the saved theme." };
  }
  return undefined;
}
