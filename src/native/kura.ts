import { invoke } from "./invoke";

/** Kura is Misty's separate, account-free file manager. */
export const kuraDownloadUrl = "https://github.com/misty-org/kura/releases/latest";

/** Whether this computer has an app registered for `kura://` links. */
export function kuraInstalled(): Promise<boolean> {
  return invoke("kura_installed");
}

/** Hands a search or a file to Kura. Fails when Kura is not installed. */
export function kuraOpen(
  link: { action: "search"; query: string } | { action: "open"; path: string; select?: string },
): Promise<void> {
  return invoke("kura_open", { link });
}
