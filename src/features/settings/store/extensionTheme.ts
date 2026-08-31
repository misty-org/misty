import { useAppThemeStore, type ResolvedAppTheme } from "./useAppThemeStore";

export type ExtensionThemeMode = "dark" | "light";
export type ExtensionThemeTokens = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  primaryContrast: string;
  accent: string;
  focus: string;
  selection: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  shadow: string;
};

export type ExtensionThemeSnapshot = {
  themeId: string;
  mode: ExtensionThemeMode;
  revision: number;
  tokens: ExtensionThemeTokens;
};

type EditableThemeTokens = Pick<
  ExtensionThemeTokens,
  | "background"
  | "surface"
  | "text"
  | "textMuted"
  | "accent"
  | "selection"
  | "success"
  | "warning"
  | "danger"
>;

const storageKey = "misty.extension-theme.v1";
export const extensionThemeChangedEvent = "misty://extension-theme-changed";

const presets: Record<string, EditableThemeTokens> = {
  "misty-dark": {
    background: "#131313",
    surface: "#161616",
    text: "#E0E0E0",
    textMuted: "#8C8C8C",
    accent: "#A3BFAB",
    selection: "#3E3E3E",
    success: "#A3BFAB",
    warning: "#E2C08D",
    danger: "#D89C8A",
  },
  "misty-light": {
    background: "#F5F2EC",
    surface: "#EBE6DE",
    text: "#302E2B",
    textMuted: "#716D67",
    accent: "#51745D",
    selection: "#D8D2C9",
    success: "#51745D",
    warning: "#8A641D",
    danger: "#9A4E45",
  },
  graphite: {
    background: "#111214",
    surface: "#17191C",
    text: "#E2E5E8",
    textMuted: "#9298A0",
    accent: "#A0C4D4",
    selection: "#363B42",
    success: "#A3BFAB",
    warning: "#D6B77F",
    danger: "#D69A91",
  },
  aurora: {
    background: "#101514",
    surface: "#151B19",
    text: "#DFE6E2",
    textMuted: "#8F9D97",
    accent: "#8FC9BC",
    selection: "#2D4540",
    success: "#9CC6A8",
    warning: "#D7BC82",
    danger: "#D3978F",
  },
  copper: {
    background: "#161310",
    surface: "#1D1915",
    text: "#E8DED4",
    textMuted: "#9D9187",
    accent: "#D5A06F",
    selection: "#4A382A",
    success: "#A7B68D",
    warning: "#D5A06F",
    danger: "#CE8F80",
  },
};

let previewSnapshot: ExtensionThemeSnapshot | null = null;
let revision = 0;

export function extensionThemeSnapshot(): ExtensionThemeSnapshot {
  return (
    previewSnapshot ?? storedSnapshot() ?? snapshotFromEditable("misty-dark", presets["misty-dark"])
  );
}

export function applyStoredExtensionTheme(): ExtensionThemeSnapshot {
  previewSnapshot = null;
  const snapshot = extensionThemeSnapshot();
  applySnapshot(snapshot);
  return snapshot;
}

export function revertExtensionThemePreview(): void {
  if (!previewSnapshot) return;
  previewSnapshot = null;
  applySnapshot(extensionThemeSnapshot());
  announceThemeChange();
}

export function runExtensionThemeCommand(
  command: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (command === "themes.snapshot") {
    const snapshot = extensionThemeSnapshot();
    return response(snapshot, "Current Misty theme loaded.");
  }

  if (command === "themes.applyPreset") {
    const presetId = typeof payload.preset === "string" ? payload.preset : "";
    const preset = presets[presetId];
    if (!preset) return { ok: false, message: "That theme preset is unavailable." };
    const snapshot = snapshotFromEditable(presetId, preset);
    if (payload.preview === false) {
      persistSnapshot(snapshot);
      previewSnapshot = null;
    } else {
      previewSnapshot = snapshot;
    }
    applySnapshot(snapshot);
    announceThemeChange();
    return response(snapshot, `Previewing ${presetLabel(presetId)}.`);
  }

  if (command === "themes.preview" || command === "themes.apply") {
    const current = extensionThemeSnapshot();
    const editable = editableTokens(payload.tokens, current.tokens);
    if (!editable) return { ok: false, message: "Theme colors must use six-digit hex values." };
    const requestedId =
      typeof payload.preset === "string" && payload.preset in presets ? payload.preset : "custom";
    const snapshot = snapshotFromEditable(requestedId, editable);
    if (command === "themes.apply") {
      persistSnapshot(snapshot);
      previewSnapshot = null;
    } else {
      previewSnapshot = snapshot;
    }
    applySnapshot(snapshot);
    announceThemeChange();
    return response(snapshot, command === "themes.apply" ? "Theme saved." : "Preview updated.");
  }

  if (command === "themes.revert") {
    previewSnapshot = null;
    const snapshot = storedSnapshot() ?? snapshotFromEditable("misty-dark", presets["misty-dark"]);
    applySnapshot(snapshot);
    announceThemeChange();
    return response(snapshot, "Reverted to the saved theme.");
  }

  return { ok: false, message: "This theme command is unavailable." };
}

function snapshotFromEditable(
  themeId: string,
  editable: EditableThemeTokens,
): ExtensionThemeSnapshot {
  revision += 1;
  const mode: ExtensionThemeMode = relativeLuminance(editable.background) > 0.55 ? "light" : "dark";
  const raised = mix(editable.surface, editable.text, mode === "light" ? 0.04 : 0.025);
  const hover = mix(editable.surface, editable.text, mode === "light" ? 0.1 : 0.09);
  const border = mix(editable.background, editable.text, mode === "light" ? 0.14 : 0.09);
  const borderStrong = mix(editable.background, editable.text, mode === "light" ? 0.25 : 0.2);
  const textSubtle = mix(editable.background, editable.textMuted, 0.78);
  return {
    themeId,
    mode,
    revision,
    tokens: {
      ...editable,
      surfaceRaised: raised,
      surfaceHover: hover,
      border,
      borderStrong,
      textSubtle,
      primary: editable.selection,
      primaryContrast: editable.text,
      focus: editable.text,
      info: editable.accent,
      shadow: mode === "light" ? "rgba(58, 48, 40, .18)" : "rgba(0, 0, 0, .48)",
    },
  };
}

function response(snapshot: ExtensionThemeSnapshot, message: string) {
  return {
    ok: true,
    themeId: snapshot.themeId,
    mode: snapshot.mode,
    revision: snapshot.revision,
    tokens: snapshot.tokens,
    message,
  };
}

function editableTokens(
  value: unknown,
  fallback: ExtensionThemeTokens,
): EditableThemeTokens | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys: Array<keyof EditableThemeTokens> = [
    "background",
    "surface",
    "text",
    "textMuted",
    "accent",
    "selection",
    "success",
    "warning",
    "danger",
  ];
  const result = {} as EditableThemeTokens;
  for (const key of keys) {
    const candidate = source[key] ?? fallback[key];
    if (typeof candidate !== "string" || !/^#[0-9a-f]{6}$/i.test(candidate)) return null;
    result[key] = candidate.toUpperCase();
  }
  return result;
}

function persistSnapshot(snapshot: ExtensionThemeSnapshot): void {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ themeId: snapshot.themeId, tokens: editableFromSnapshot(snapshot) }),
    );
  } catch {
    // The active theme still applies for this session when storage is unavailable.
  }
}

function storedSnapshot(): ExtensionThemeSnapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { themeId?: unknown; tokens?: unknown };
    const editable = editableTokens(
      parsed.tokens,
      snapshotFromEditable("misty-dark", presets["misty-dark"]).tokens,
    );
    if (!editable) return null;
    const themeId = typeof parsed.themeId === "string" ? parsed.themeId.slice(0, 64) : "custom";
    return snapshotFromEditable(themeId, editable);
  } catch {
    return null;
  }
}

function editableFromSnapshot(snapshot: ExtensionThemeSnapshot): EditableThemeTokens {
  const { background, surface, text, textMuted, accent, selection, success, warning, danger } =
    snapshot.tokens;
  return { background, surface, text, textMuted, accent, selection, success, warning, danger };
}

function applySnapshot(snapshot: ExtensionThemeSnapshot): void {
  const root = document.documentElement;
  const { tokens } = snapshot;
  root.dataset.theme = snapshot.mode;
  root.dataset.themeMode = snapshot.mode;
  root.dataset.mistyTheme = snapshot.themeId;
  root.classList.toggle("dark", snapshot.mode === "dark");
  root.style.colorScheme = snapshot.mode;
  const cssTokens: Record<string, string> = {
    "--misty-theme-workspace": mix(
      tokens.background,
      "#000000",
      snapshot.mode === "light" ? 0.02 : 0.18,
    ),
    "--misty-theme-bg": tokens.background,
    "--misty-theme-sidebar": tokens.surface,
    "--misty-theme-card": tokens.surfaceRaised,
    "--misty-theme-border": tokens.border,
    "--misty-theme-hover": tokens.surfaceHover,
    "--misty-theme-active": tokens.selection,
    "--misty-theme-text": tokens.text,
    "--misty-theme-text-bright": mix(
      tokens.text,
      snapshot.mode === "light" ? "#000000" : "#FFFFFF",
      0.08,
    ),
    "--misty-theme-text-muted": tokens.textMuted,
    "--misty-theme-danger": tokens.danger,
    "--misty-theme-sage": tokens.success,
    "--misty-theme-sage-bg": mix(
      tokens.background,
      tokens.success,
      snapshot.mode === "light" ? 0.12 : 0.17,
    ),
  };
  for (const [name, value] of Object.entries(cssTokens)) root.style.setProperty(name, value);
  useAppThemeStore.getState().setResolvedTheme(snapshot.mode as ResolvedAppTheme);
}

function announceThemeChange(): void {
  window.dispatchEvent(new CustomEvent(extensionThemeChangedEvent));
}

function presetLabel(id: string): string {
  return id
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function mix(first: string, second: string, weight: number): string {
  const ratio = Math.min(1, Math.max(0, weight));
  const channels = [1, 3, 5].map((index) => {
    const start = Number.parseInt(first.slice(index, index + 2), 16);
    const end = Number.parseInt(second.slice(index, index + 2), 16);
    return Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}
