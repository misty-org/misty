import { invoke } from "@/native/invoke";
import { useEffect, useState } from "react";

/** A model a provider offers, as `model_keys_models` lists it. */
export interface ListedModel {
  id: string;
  label: string;
  embedding: boolean;
}

/** A key the native app confirmed by listing its provider's models, then saved. */
export interface AddedKey {
  provider: string;
  models: ListedModel[];
  saved: string[];
}

/** Adds a pasted key; its provider is found from the key, or checked against `provider`. */
export async function addModelKey(key: string, provider?: string): Promise<AddedKey> {
  return invoke<AddedKey>("model_keys_add", { key, provider: provider ?? null });
}

/** The models a provider offers this device; null while listing, [] when it can't list. */
export function useProviderModels(provider: string, ready: boolean, revision = 0) {
  const [models, setModels] = useState<ListedModel[] | null>(null);
  useEffect(() => {
    if (!ready) {
      setModels([]);
      return;
    }
    let live = true;
    setModels(null);
    invoke<ListedModel[]>("model_keys_models", { provider })
      .then((next) => live && setModels(next))
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [provider, ready, revision]);
  return models;
}
