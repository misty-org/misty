import { getCurrentWebview } from "@tauri-apps/api/webview";
import { requireDesktopHost } from "./require_desktop_host";

const island = async () => {
  const { label } = getCurrentWebview();
  if (label === "misty-desktop-island") {
    await import("@/styles/styles.css");
  }
};

export const desktopStartup = requireDesktopHost()
  ? Promise.all([
      import("react-dom/client"),
      import("react"),
      import("@/features/agents/desktop-control/DesktopOverlayRoot"),
      island(),
    ]).then(([{ createRoot }, { createElement }, { DesktopOverlayRoot }]) => {
      createRoot(document.getElementById("root")!).render(createElement(DesktopOverlayRoot));
    })
  : Promise.resolve();
