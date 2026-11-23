import { invoke } from "@tauri-apps/api/core";
import { showStartupFailure } from "./startup_failure";
import { requireDesktopHost } from "./require_desktop_host";

if (requireDesktopHost()) {
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
          void invoke("reveal_main_window").catch(() => undefined);
        }
      },
    );
}
