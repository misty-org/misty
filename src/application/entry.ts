import { showStartupFailure } from "./startupFailure";

// Keep this entry independent of React, the SDK, and the rest of the app graph.
// Even a missing module export must leave a usable reload action on screen.
void import("./main")
  .then(({ startup }) => startup)
  .catch((error: unknown) => {
    console.error("Misty could not start:", error);
    showStartupFailure();
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("reveal_main_window"))
        .catch(() => undefined);
    }
  });
