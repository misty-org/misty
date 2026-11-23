// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { requireDesktopHost } from "./require_desktop_host";

export const petStartup = requireDesktopHost()
  ? Promise.all([
      import("react-dom/client"),
      import("react"),
      import("@/features/pets/PetOverlayApp"),
    ])
      .then(([{ createRoot }, { createElement }, { PetOverlayApp }]) => {
        createRoot(document.getElementById("root")!).render(createElement(PetOverlayApp));
      })
      .catch((error: unknown) => {
        console.error("The pet could not load", error);
      })
  : Promise.resolve();
