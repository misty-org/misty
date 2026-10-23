import { requireDesktopHost } from "./requireDesktopHost";

// The desktop control island and mist on Windows (desktop_overlays_windows.rs).
// Only the island uses the app's controls and theme; the mist stays bare so
// nothing opaque ever covers the screen.
const island = async () => {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  if (getCurrentWindow().label === "misty-desktop-island") await import("@/styles/styles.css");
};

export const desktopStartup = requireDesktopHost()
  ? Promise.all([
      import("react-dom/client"),
      import("react"),
      import("@/features/agents/desktop/DesktopOverlayRoot"),
      island(),
    ]).then(([{ createRoot }, { createElement }, { DesktopOverlayRoot }]) => {
      createRoot(document.getElementById("root")!).render(createElement(DesktopOverlayRoot));
    })
  : Promise.resolve();
