// Keep startup failure visible in the main Agents page instead of a blank native window.
export const cursorStartup = Promise.all([
  import("react-dom/client"),
  import("react"),
  import("@/features/agents/companion/CursorCompanionRoot"),
])
  .then(([{ createRoot }, { createElement }, { CursorCompanionRoot }]) => {
    createRoot(document.getElementById("root")!).render(createElement(CursorCompanionRoot));
  })
  .catch(async (error: unknown) => {
    console.error("Companion renderer could not start", error);
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", "misty://cursor-renderer-error", {
      error: "The cursor could not load. Restart Misty after updating the desktop app.",
    });
  });
