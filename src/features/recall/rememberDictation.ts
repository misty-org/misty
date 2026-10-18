import { publicBetaFeatureEnabled } from "@/features/launch";
import { useSettingsStore } from "@/features/settings";
import { memoryApi } from "./api";
import { recallSettings } from "./recallSettings";
import { redactSecrets } from "./recorder/privacy";

/** Keeps what the person dictated in Memory, when they allow it. */
export function rememberDictation(text: string) {
  const settings = recallSettings(useSettingsStore.getState().settings?.document);
  if (
    !publicBetaFeatureEnabled("recall") ||
    !settings.enabled ||
    !settings.rememberDictation ||
    settings.pausedUntil > Date.now()
  )
    return;
  const body = redactSecrets(text.trim());
  if (!body) return;
  const title = body.length > 60 ? `${body.slice(0, 57).trimEnd()}…` : body;
  void memoryApi
    .record({ kind: "voice", title, body, occurred_at: new Date().toISOString() })
    .catch(() => {});
}
