import { invoke } from "@/native/invoke";
import { useCallback, useEffect, useState } from "react";
import { addModelKey, type AddedKey } from "./modelAccounts";

/** Fires in this window when a saved key changes, so what depends on one can look again. */
export const modelKeysChangedEvent = "misty:model-keys-changed";

/** The native app's own words when it gives them, else a plain line saying what failed. */
function failure(cause: unknown, fallback: string): Error {
  const text = typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "";
  return new Error(text.trim() || fallback);
}

/**
 * Provider keys live in the device keychain, written and read only by the native app. The
 * renderer learns which providers have a key, never the key itself. Saving and removing throw
 * with a message the person can act on, which the key's field shows under itself.
 */
export function useSavedModelKeys() {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  // What the boolean save and remove below last failed with, for callers that show it themselves.
  const [failed, setFailed] = useState("");
  useEffect(() => {
    let live = true;
    invoke<string[]>("model_keys_saved")
      .then((providers) => live && setSaved(providers))
      .catch(() => {
        if (!live) return;
        setSaved([]);
        setUnreadable(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const changed = useCallback((providers: string[]) => {
    setSaved(providers);
    setUnreadable(false);
    window.dispatchEvent(new CustomEvent(modelKeysChangedEvent));
  }, []);
  const saveKey = async (providerId: string, key: string) => {
    try {
      changed(await invoke<string[]>("model_keys_save", { providerId, key }));
    } catch (cause) {
      throw failure(cause, "The key couldn't be saved to the keychain. Try again.");
    }
  };
  const removeKey = async (providerId: string) => {
    try {
      changed(await invoke<string[]>("model_keys_remove", { providerId }));
    } catch (cause) {
      throw failure(cause, "The key couldn't be removed from the keychain. Try again.");
    }
  };
  /** Runs a save or remove and says whether it worked, keeping its message in `error`. */
  const settle = async (work: () => Promise<void>) => {
    setFailed("");
    try {
      await work();
      return true;
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  return {
    saved,
    /** The keychain couldn't be read, so no key shows as saved. */
    unreadable,
    saveKey,
    removeKey,
    /** saveKey and removeKey for callers that show the failure themselves, from `error`. */
    save: (providerId: string, key: string) => settle(() => saveKey(providerId, key)),
    remove: (providerId: string) => settle(() => removeKey(providerId)),
    error: failed || (unreadable ? "Saved keys couldn't be read from the keychain." : ""),
    /** A pasted key: its provider is found from the key itself, else `fallback` is tried. */
    add: async (key: string, fallback?: string): Promise<AddedKey> => {
      try {
        let added: AddedKey;
        try {
          added = await addModelKey(key);
        } catch (detection) {
          if (!fallback) throw detection;
          added = await addModelKey(key, fallback);
        }
        changed(added.saved);
        return added;
      } catch (cause) {
        throw failure(cause, "That key couldn't be saved. Check it and paste it again.");
      }
    },
  };
}

export type SavedModelKeys = ReturnType<typeof useSavedModelKeys>;

/** Opens Settings on the Models page. */
export function openModelSettings() {
  window.dispatchEvent(new CustomEvent("misty:open-settings", { detail: { section: "models" } }));
}
