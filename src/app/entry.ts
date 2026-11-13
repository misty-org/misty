import { showStartupFailure } from "./startupFailure";
import { requireDesktopHost } from "./requireDesktopHost";

// Keep this entry independent of React and the rest of the app graph.
// Even a missing module export must leave a usable reload action on screen.
if (requireDesktopHost()) {
  // In development, a page still marked starting after its modules stop arriving, or marked
  // failed, reloads itself once the dev server answers (`tasks/dead-page-watchdog.ts`).
  const marks = document.documentElement.dataset;
  marks.mistyStarting = "";
  void import("./main")
    .then(({ startup }) => startup)
    .then(
      () => {
        delete marks.mistyStarting;
      },
      (error: unknown) => {
        delete marks.mistyStarting;
        marks.mistyStartFailed = "";
        console.error("Misty could not start:", error);
        showStartupFailure();
        if ("__TAURI_INTERNALS__" in window) {
          void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("reveal_main_window"))
            .catch(() => undefined);
        }
      },
    );
}
