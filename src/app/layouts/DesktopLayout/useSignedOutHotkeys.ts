import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { openMisty } from "@/features/agents";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * While nobody is signed in, the companion chord and the dictation key open the Agents page:
 * agents work signed out, and the companion and dictation need an account. The native side arms them only when Input Monitoring is already granted,
 * so browsing without an account never asks for it.
 */
export function useSignedOutHotkeys(signedOut: boolean) {
  useEffect(() => {
    if (!signedOut || !hasTauriInternals()) return;
    void invoke("global_hotkey_signed_out", { enabled: true }).catch(() => undefined);
    const stop = listen("misty://signed-out-hotkey", () => void openMisty().catch(() => undefined));
    return () => {
      void invoke("global_hotkey_signed_out", { enabled: false }).catch(() => undefined);
      void stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [signedOut]);
}
