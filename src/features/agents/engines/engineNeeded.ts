/**
 * Whether an AI error is a run that couldn't start for want of a default engine: Misty has no model
 * of its own, so its work runs on the engine the person picks in Settings › Agents. Older errors
 * that still say a model key is missing count too.
 */
export function needsDefaultEngine(message: string | null | undefined): boolean {
  return Boolean(message && /\bdefault engine\b|\bmodel key\b/i.test(message));
}

/** Opens Settings › Agents › Engine, where the default engine is picked. */
export function openEngineSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
}
