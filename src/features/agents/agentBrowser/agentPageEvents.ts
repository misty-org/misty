import { listen } from "@tauri-apps/api/event";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { AgentBrowserTab } from "./agentBrowserStore";

type PageChange = Partial<Pick<AgentBrowserTab, "url" | "title" | "loading" | "faviconUrl">>;

let started = false;

/**
 * Follows what an agent's live pages report, the same events a tab's page sends
 * (browserPageListeners.ts): where it is, its title and icon, and whether it is loading. They
 * update the agent browser's tab rows and address, never the person's tabs or history.
 */
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
    listen<{ id: string }>("misty://browser-stopped", ({ payload }) => note(payload.id, { loading: false })),
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
