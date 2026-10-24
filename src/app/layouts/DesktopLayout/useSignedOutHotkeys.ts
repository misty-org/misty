import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { openSignInSheet } from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * While nobody is signed in, the companion chord and the dictation key open the sign-in
 * sheet for agents. The native side arms them only when Input Monitoring is already granted,
 * so browsing without an account never asks for it (docs/design/no-account-browsing/BRIEF.md).
 */
export function useSignedOutHotkeys(signedOut: boolean) {
  useEffect(() => {
    if (!signedOut || !hasTauriInternals()) return;
    void invoke("global_hotkey_signed_out", { enabled: true }).catch(() => undefined);
    const stop = listen("misty://signed-out-hotkey", () => openSignInSheet("agents"));
    return () => {
      void invoke("global_hotkey_signed_out", { enabled: false }).catch(() => undefined);
      void stop.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [signedOut]);
}
