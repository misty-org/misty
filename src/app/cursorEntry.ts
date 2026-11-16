import { requireDesktopHost } from "./requireDesktopHost";

// Keep startup failure visible in the main Agents page instead of a blank native window.
// The same page, opened at #ask, is Tutor's text box beside the pointer instead of the overlay.
const asking = window.location.hash === "#ask";

export const cursorStartup = requireDesktopHost()
  ? Promise.all([
      import("react-dom/client"),
      import("react"),
      asking
        ? import("@/features/agents/tutor/cursor/TutorAskBox").then((m) => m.TutorAskBox)
        : import("@/features/agents/tutor/cursor/CursorCompanionRoot").then(
            (m) => m.CursorCompanionRoot,
          ),
    ])
      .then(([{ createRoot }, { createElement }, Root]) => {
        createRoot(document.getElementById("root")!).render(createElement(Root));
      })
      .catch(async (error: unknown) => {
        console.error("Companion renderer could not start", error);
        const { emit } = await import("@tauri-apps/api/event");
        await emit("misty://cursor-renderer-error", {
          error: "The cursor could not load. Restart Misty after updating the desktop app.",
        });
      })
  : Promise.resolve();
