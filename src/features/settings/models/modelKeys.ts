import { apiRequest } from "@/api/client";
import { invoke } from "@/native/invoke";
import { useCallback, useEffect, useState } from "react";

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
  return {
    saved,
    error,
    save: (providerId: string, key: string) =>
      run(() => invoke<string[]>("model_keys_save", { providerId, key })),
    remove: (providerId: string) =>
      run(() => invoke<string[]>("model_keys_remove", { providerId })),
  };
}

/**
 * Whether the Misty server supplies its own models (`GET /instance`), in which case
 * this device's keys are optional. Unknown while loading or when the server is unreachable.
 */
export function useOperatorModels(): boolean | null {
  const [operator, setOperator] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    apiRequest<{ models?: { operator?: boolean } }>("/instance")
      .then((instance) => live && setOperator(instance.models?.operator === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return operator;
}

/** Opens Settings on the Models page. */
export function openModelSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
}
