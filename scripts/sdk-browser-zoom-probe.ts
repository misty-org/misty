import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
const nonce = new URLSearchParams(location.search).get("nonce")!;
const request = { id: "zoom-probe" };
const log = (message: unknown) =>
  invoke("sdk_probe_log", { nonce, message: JSON.stringify(message) });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let loaded = false;
const unlisten = await listen<{ id: string; phase: string }>(
  "misty://browser-page",
  ({ payload }) => {
    if (payload.id === request.id && payload.phase === "finished") loaded = true;
  },
);
try {
  await invoke("browser_webview_create", {
    request: {
      ...request,
      url: location.origin + "/scripts/sdk-browser-zoom-page.html",
      x: 0,
      y: 44,
      width: innerWidth,
      height: innerHeight - 44,
      scopeId: "zoom-probe",
      theme: "dark",
      nativeLiveResize: false,
    },
  });
  for (let i = 0; i < 100 && !loaded; i++) await wait(100);
  if (!loaded) throw new Error("Scrolling fixture did not load");
  for (const factor of [1, 1.25, 2, 5]) {
    await invoke("browser_webview_set_zoom", { request: { ...request, factor } });
    await wait(200);
    const state = await invoke<any>("sdk_probe_browser_zoom_state", {
      nonce,
      scroll: false,
      smoothScroll: true,
    });
    await log({ factor, ...state });
    if (Math.abs(state.scrollX - 120) > 2 || Math.abs(state.scrollY - 2400) > 2)
      throw new Error(`Smooth scrolling was interrupted at ${factor * 100}%`);
    if (
      state.scrollWrites ||
      state.styleQueries ||
      state.injectedScrollbar ||
      state.injectedStyle ||
      state.pan
    )
      throw new Error(`Misty interfered with website scrolling at ${factor * 100}%`);
    if (state.transform !== state.expectedTransform || !state.frames)
      throw new Error("Page-owned animation was changed or stopped");
  }
  await invoke("browser_webview_close", { request });
  await invoke("sdk_probe_complete", {
    nonce,
    success: true,
    message:
      "Native X/Y smooth scrolling and page animations preserved at 100%, 125%, 200%, and 500%; no injected scrollbars, scans, or scroll resets",
  });
} catch (error) {
  await invoke("sdk_probe_complete", { nonce, success: false, message: String(error) });
} finally {
  unlisten();
}
