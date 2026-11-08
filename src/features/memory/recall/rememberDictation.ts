import { useSettingsStore } from "@/features/settings";
import { isIncognitoWindow } from "@/features/app-windows";
import { memoryApi } from "./api";
import { recallSettings, type RecallSettings } from "./recallSettings";
import { redactSecrets, rememberedUrl, skipReason } from "./recorder/privacy";

/** The most of a capture's transcript a moment keeps; the transcript itself stays whole. */
const CAPTURE_BODY_LIMIT = 6_000;

const allowed = (settings: RecallSettings) =>
  settings.enabled && settings.rememberDictation && settings.pausedUntil <= Date.now();

/** Keeps what the person dictated in Memory, when they allow it. */
export function rememberDictation(text: string) {
  if (!allowed(recallSettings(useSettingsStore.getState().settings?.document))) return;
  const body = redactSecrets(text.trim());
  if (!body) return;
  const title = body.length > 60 ? `${body.slice(0, 57).trimEnd()}…` : body;
  void memoryApi
    .record({ kind: "voice", title, body, occurred_at: new Date().toISOString() })
    .catch(() => {});
}

/**
 * Keeps what a capture heard in Memory so a recap can read it, when the person allows it. A tab's
 * capture follows the same rules as remembering that tab's page.
 */
export function rememberCapture(capture: {
  id: string;
  title: string;
  text: string;
  url?: string;
}) {
  const settings = recallSettings(useSettingsStore.getState().settings?.document);
  if (!allowed(settings) || isIncognitoWindow()) return;
  if (capture.url && skipReason({ url: capture.url, private: false }, settings)) return;
  const body = redactSecrets(capture.text.trim()).slice(0, CAPTURE_BODY_LIMIT);
  if (!body) return;
  void memoryApi
    .record({
      kind: "voice",
      title: capture.title.slice(0, 300),
      body,
      ...(capture.url ? { url: rememberedUrl(capture.url) } : {}),
      ref_id: capture.id,
      occurred_at: new Date().toISOString(),
    })
    .catch(() => {});
}
