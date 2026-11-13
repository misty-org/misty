import { useEffect, useState } from "react";
import { invoke } from "@/native/invoke";
import { useModelSetting } from "../../models/ModelChoiceRows";
import { modelKeysChangedEvent } from "../../models/modelKeys";
import { providerById } from "../../models/modelProviders";

/**
 * Whether Tutor is set up. Its only required step is a model with a key: the Tutor model (the
 * fast role) when one is chosen, else the main model, on a provider whose key is saved or that
 * needs none. Voice keys are optional extras (Soniox to hear, ElevenLabs to talk back).
 */

/** The provider a `provider/model` ID names. */
export function providerOf(model: string): string {
  return model.split("/")[0]?.trim() ?? "";
}

/** The model Tutor answers with, and whether it can run: its provider has a key or needs none. */
export function tutorModel(
  fastModel: string,
  mainModel: string,
  savedKeys: readonly string[],
): { model: string; provider: string; ready: boolean } {
  const model = fastModel.trim() || mainModel.trim();
  const provider = providerOf(model);
  const known = providerById(provider);
  const ready = Boolean(model && known && (known.keyOptional || savedKeys.includes(provider)));
  return { model, provider, ready };
}

/** The providers with a saved key, read again whenever a key changes in this window. */
export function useSavedKeyIds(): string[] | null {
  const [saved, setSaved] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      invoke<string[]>("model_keys_saved")
        .then((ids) => live && setSaved(ids))
        .catch(() => live && setSaved([]));
    void read();
    window.addEventListener(modelKeysChangedEvent, read);
    return () => {
      live = false;
      window.removeEventListener(modelKeysChangedEvent, read);
    };
  }, []);
  return saved;
}

/** Tutor's model and whether it's set up; `ready` is undefined until the keychain answers. */
export function useTutorSetup(): { model: string; provider: string; ready: boolean | undefined } {
  const fast = useModelSetting("models.fast_model");
  const main = useModelSetting("models.agent_model");
  const saved = useSavedKeyIds();
  const setup = tutorModel(fast.value, main.value, saved ?? []);
  return { ...setup, ready: saved === null ? undefined : setup.ready };
}
