import { hasTauriInternals } from "@/shared/platform/tauri";

/** Gate both app entry points before importing account, analytics or native runtimes. */
export function requireDesktopHost(): boolean {
  if (hasTauriInternals()) return true;
  const root = document.getElementById("root");
  if (root) {
    const panel = document.createElement("main");
    panel.setAttribute("role", "alert");
    panel.style.cssText = "padding:32px;color:#eee;background:#131313;font:14px/1.5 system-ui";
    const title = document.createElement("h1");
    title.textContent = "Misty is a desktop app";
    title.style.cssText = "font-size:22px;margin:0 0 14px;font-weight:600";
    const message = document.createElement("p");
    message.textContent = "Open the installed Misty app to continue.";
    panel.append(title, message);
    root.replaceChildren(panel);
  }
  return false;
}
