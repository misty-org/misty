import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { hasTauriInternals } from "./tauri";

export async function confirmAction(message: string, title = "Misty"): Promise<boolean> {
  if (!hasTauriInternals()) return globalThis.confirm(message);
  return confirmDialog(message, { title, kind: "warning" });
}
