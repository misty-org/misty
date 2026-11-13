import { requireDesktopHost } from "./requireDesktopHost";

// The desktop control island and mist on Windows (agents/desktop_control/windows/overlays.rs). The
// island uses the app's controls and theme; the mist stays bare so nothing opaque ever covers the
// screen.
const island = async () => {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
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
