import { invoke } from "@/native/invoke";
import { useCallback, useEffect, useState } from "react";
import { addModelKey, signInToOpenRouter, type AddedKey } from "./modelAccounts";

/**
 * Provider keys live in the device keychain, written and read only by the native app.
 * The renderer learns which providers have a key, never the key itself.
 */
export function useSavedModelKeys() {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    invoke<string[]>("model_keys_saved")
      .then((providers) => live && setSaved(providers))
      .catch(() => {
        if (!live) return;
        setSaved([]);
        setError("Saved keys couldn't be read from the keychain.");
      });
    return () => {
      live = false;
    };
  }, []);
  const run = useCallback(async (work: () => Promise<string[]>) => {
    setError("");
    try {
      setSaved(await work());
      return true;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "The keychain couldn't be reached.");
      return false;
    }
  }, []);
  /** Saves a key once its provider listed models with it; null when no provider took it. */
  const added = useCallback(async (work: () => Promise<AddedKey>) => {
    setError("");
    try {
      const result = await work();
      setSaved(result.saved);
      return result;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "That key couldn't be saved.");
      return null;
    }
  }, []);
  return {
    saved,
    error,
    save: (providerId: string, key: string) =>
      run(() => invoke<string[]>("model_keys_save", { providerId, key })),
    remove: (providerId: string) =>
      run(() => invoke<string[]>("model_keys_remove", { providerId })),
    /** A pasted key: its provider is found from the key itself, else `fallback` is tried. */
    add: (key: string, fallback?: string) =>
      added(async () => {
        try {
          return await addModelKey(key);
        } catch (detection) {
          if (!fallback) throw detection;
          return addModelKey(key, fallback);
        }
      }),
    signInToOpenRouter: () => added(signInToOpenRouter),
  };
}

export type SavedModelKeys = ReturnType<typeof useSavedModelKeys>;

/** Opens Settings on the Models page. */
export function openModelSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
}
