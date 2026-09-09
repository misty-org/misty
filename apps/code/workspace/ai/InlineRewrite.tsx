import { SystemErrorActivity } from "@/features/activity";
import { ShortcutHint, useShortcutHandler } from "@/features/shortcuts";
import { readApiKey } from "./keychain";
import { streamRewrite } from "./providers";
import { useAiSettings } from "./useAiSettings";
import { createInlineRewrite } from "./createInlineRewrite";
export const InlineRewrite = createInlineRewrite({
  useSettings: useAiSettings, ShortcutHint, useShortcutHandler, SystemErrorActivity,
  async rewrite(input) {
    const settings = useAiSettings.getState();
    const apiKey = await readApiKey(settings.providerId);
    if (!apiKey) throw new Error("No API key stored. Open AI settings to add one.");
    await streamRewrite({...input, settings, apiKey});
  },
});
