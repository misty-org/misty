import { useModelSetting } from "../models/ModelChoiceRows";
import { useSavedKeyIds } from "./cursor/tutorSetup";

/** The search services, in the order native code falls back to: an unknown choice is the first. */
const searchProviders = ["decodo", "serper"] as const;

/** The search service web search runs on: the one chosen in Settings › Models, else the first. */
export function searchProviderOf(chosen: string): string {
  return (searchProviders as readonly string[]).includes(chosen) ? chosen : searchProviders[0];
}

/**
 * Which of the Lab's key-backed extras can run on this device: recordings are transcribed on the
 * Soniox key, and news comes through the key of the chosen search service. Both are false until
 * the keychain answers, so nothing shows that then can't work.
 */
export function useLabKeys(): { recordings: boolean; news: boolean } {
  const saved = useSavedKeyIds();
  const provider = useModelSetting("models.search_provider");
  const keys = saved ?? [];
  return {
    recordings: keys.includes("soniox"),
    news: keys.includes(searchProviderOf(provider.value)),
  };
}
