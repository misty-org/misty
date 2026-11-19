import { errorText } from "../../context-panel/projectApi";
import type { LspLanguage } from "./languages";
import { lspApi } from "./lspApi";
import { useLspStore } from "./lspStore";

/** Each language is checked, and installed if missing, once per page load: every editor of that
 * language waits on the same promise. */
const pending = new Map<LspLanguage, Promise<void>>();

async function installIfMissing(language: LspLanguage): Promise<void> {
  const { setInstall } = useLspStore.getState();
  setInstall(language, { phase: "checking" });
  try {
    const status = await lspApi.status(language);
    if (status.installed) {
      setInstall(language, { phase: "ready", version: status.version ?? undefined });
      return;
    }
    if (status.problem) throw new Error(status.problem);
    setInstall(language, { phase: "installing" });
    const installed = await lspApi.install(language);
    setInstall(language, { phase: "ready", version: installed.version ?? undefined });
  } catch (error) {
    setInstall(language, { phase: "failed", error: errorText(error) });
    throw error;
  }
}

/** Resolves once `language`'s server is installed, installing it on first use. */
export function ensureInstalled(language: LspLanguage): Promise<void> {
  const known = pending.get(language);
  if (known) return known;
  const run = installIfMissing(language);
  pending.set(language, run);
  // A failure is tried again by the next editor, or by Try again.
  run.catch(() => {
    if (pending.get(language) === run) pending.delete(language);
  });
  return run;
}

/** Try again: every language is checked afresh and every editor looks for its server again. */
export function retryLanguageServers(): void {
  pending.clear();
  useLspStore.getState().retry();
}
