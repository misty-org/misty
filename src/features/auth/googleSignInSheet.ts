import { Channel, invoke } from "@tauri-apps/api/core";
import { deliverGoogleSignInCode } from "./googleSignInCode";

let sheetOpen = false;

/** Whether links from other apps open in Misty; unknown counts as no. */
export async function mistyIsDefaultBrowser(): Promise<boolean> {
  try {
    const status = await invoke<{ isDefault: boolean }>("settings_default_browser_snapshot");
    return status.isDefault;
  } catch {
    return false;
  }
}

/**
 * Google sign-in in macOS's own web authentication session, for when Misty is the default browser
 * and opening the link would land in one of its own tabs. macOS picks another browser for it,
 * Safari unless that one supports these sessions. It catches the server's misty:// link itself, so
 * its code goes straight to the waiting sign-in; closing it cancels the sign-in. False when there
 * is no session here, for the system browser instead.
 */
export async function openGoogleSignInSheet(url: string, cancel: () => void): Promise<boolean> {
  if (!/Mac/.test(navigator.platform)) return false;
  const closed = new Channel<string | null>();
  closed.onmessage = (link) => {
    sheetOpen = false;
    const code = link ? new URL(link).searchParams.get("code") : null;
    if (!code || !deliverGoogleSignInCode(code)) cancel();
  };
  try {
    await invoke<void>("google_sign_in_sheet_open", { url, closed });
    sheetOpen = true;
    return true;
  } catch {
    return false;
  }
}

/** Closes the sheet when the sign-in has ended some other way. */
export function closeGoogleSignInSheet(): void {
  if (!sheetOpen) return;
  sheetOpen = false;
  void invoke<void>("google_sign_in_sheet_close").catch(() => undefined);
}
