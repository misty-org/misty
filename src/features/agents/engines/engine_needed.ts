export function needsDefaultEngine(message: string | null | undefined): boolean {
  return Boolean(message && /\bdefault engine\b|\bmodel key\b/i.test(message));
}

export function openEngineSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
}
