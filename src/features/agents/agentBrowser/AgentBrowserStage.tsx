import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { Skeleton } from "@/shared/ui";
import { agentTab, setShownAgentTab, wakeAgentTab } from "../agentTabs";
import { useAgentBrowser } from "./agentBrowserStore";

/** Whether the stage is on screen: its page (a native view above the app) must not cover anything else. */
const onScreen = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return (
    element.isConnected &&
    document.visibilityState === "visible" &&
    rect.width > 0 &&
    rect.height > 0 &&
    !element.closest('[aria-hidden="true"], [hidden], [inert]')
  );
};

/**
 * Where an agent's live page shows in the split. Showing a tab wakes it (a tab in view never
 * sleeps, agentTabs.ts); the page follows the stage's size, and goes back out of sight, still
 * painting for the agent, when the stage leaves the screen.
 */
export function AgentBrowserStage({ scopeId, locked }: { scopeId: string; locked: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const asleep = useAgentBrowser((state) => state.tabs[scopeId]?.asleep ?? true);

  useEffect(() => {
    if (!scopeId) return;
    setShownAgentTab(scopeId);
    let shownId = "";
    let placed = "";
    let stopped = false;
    const hide = () => {
      if (shownId) void invoke("browser_webview_hide", { request: { id: shownId, keepLive: true } }).catch(() => undefined);
      shownId = "";
      placed = "";
    };
    const place = () => {
      const element = ref.current;
      const id = agentTab(scopeId)?.viewId;
      if (stopped || !element || !id || !onScreen(element)) return hide();
      if (shownId && shownId !== id) hide();
      const rect = element.getBoundingClientRect();
      const scale = getAppliedAppRenderScale();
      const bounds = { x: rect.left * scale, y: rect.top * scale, width: rect.width * scale, height: rect.height * scale };
      const key = `${id}:${Object.values(bounds).map(Math.round).join(",")}`;
      if (key === placed) return;
      placed = key;
      shownId = id;
      void invoke("browser_webview_set_bounds", { request: { id, ...bounds } })
        .then(() => invoke("browser_webview_show", { request: { id } }))
        .catch(() => undefined);
    };
    void wakeAgentTab(scopeId).then(place);
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    // A page that woke, moved or was replaced by the agent, and a chat page that left the screen.
    const timer = window.setInterval(place, 1_000);
    window.addEventListener("misty:workspace-geometry-changed", place);
    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("misty:workspace-geometry-changed", place);
      setShownAgentTab(undefined);
      hide();
    };
  }, [scopeId]);

  // While the agent acts, its page takes no input from the person (the ring marks it).
  useEffect(() => {
    const id = agentTab(scopeId)?.viewId;
    if (!id) return;
    void invoke("browser_agent_set_locked", { request: { id }, locked, ring: locked }).catch(() => undefined);
  }, [scopeId, locked, asleep]);

  return (
    <div ref={ref} className="agent-browser-stage">
      {asleep && <Skeleton className="agent-browser-stage-skeleton" />}
    </div>
  );
}
