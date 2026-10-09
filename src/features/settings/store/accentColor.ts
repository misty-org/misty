/** Accent presets: the pastel family Spaces use for avatars. Empty keeps Misty monochrome. */
export const accentPresets = [
  { value: "#eab7ab", label: "Red" },
  { value: "#f0c38e", label: "Orange" },
  { value: "#f0d58c", label: "Yellow" },
  { value: "#c5cf8e", label: "Green" },
  { value: "#a8d1b3", label: "Aqua" },
  { value: "#a0c4d4", label: "Blue" },
  { value: "#d3b3c9", label: "Purple" },
] as const;

export function validAccentColor(value: string): boolean {
  return /^(#[0-9a-f]{6})?$/.test(value);
}

/**
 * One accent, applied through a single variable to a fixed set of surfaces
 * (the active tab marker, checked switches and text selection). Not a theme
 * system: everything else stays monochrome.
 */
export function applyAccentColor(value: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const accent = validAccentColor(value) ? value : "";
  if (accent) {
    root.style.setProperty("--misty-accent", accent);
    root.dataset.accent = "true";
  } else {
    root.style.removeProperty("--misty-accent");
    delete root.dataset.accent;
  }
}
