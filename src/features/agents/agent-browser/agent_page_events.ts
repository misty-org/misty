import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AgentBrowserTab } from "./agent_browser_store";

type PageChange = Partial<Pick<AgentBrowserTab, "url" | "title" | "loading" | "faviconUrl">>;

let started = false;

export function followAgentPages(note: (viewId: string, change: PageChange) => void) {
  if (started || !hasTauriInternals()) return;
  started = true;
  const web = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);
  void Promise.all([
    listen<{ id: string; url: string; phase: "started" | "finished" | "navigated" }>(
      "misty://browser-page",
      ({ payload }) => {
        const url = web(payload.url) ? payload.url : undefined;
        if (payload.phase === "started") note(payload.id, { url, loading: true });
        else if (payload.phase === "finished") note(payload.id, { url, loading: false });
        else note(payload.id, { url });
      },
    ),
    listen<{ id: string }>("misty://browser-stopped", ({ payload }) =>
      note(payload.id, { loading: false }),
    ),
    listen<{ id: string; title: string }>("misty://browser-title", ({ payload }) => {
      if (payload.title.trim()) note(payload.id, { title: payload.title.trim() });
    }),
    listen<{ id: string; url: string }>("misty://browser-favicon", ({ payload }) => {
      if (web(payload.url)) note(payload.id, { faviconUrl: payload.url });
    }),
  ]).catch(() => {
    started = false;
  });
}
