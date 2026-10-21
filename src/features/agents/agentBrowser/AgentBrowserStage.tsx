import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { SkeletonDocument } from "@/shared/ui";
import { setShownAgentTab, wakeAgentTab } from "../agentTabs";
import { useAgentBrowser } from "./agentBrowserStore";
import { agentPageKey, useAgentPageGeometry } from "./useAgentPageGeometry";

/**
 * The agent browser's page area, the small counterpart of a tab's page host (BrowserPageStage):
 * the agent's live page is placed over it by the same runtime, and until that page is on screen
 * the host paints the page color instead of showing through. Showing a tab wakes it (a tab in
 * view never sleeps, agentTabs.ts); a tab that cannot open again shows its last picture.
 */
export function AgentBrowserStage({
  scopeId,
  locked,
  picture,
}: {
  scopeId: string;
  locked: boolean;
  /** The view's last picture, for a page that cannot open again. */
  picture?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewId = useAgentBrowser((state) => state.tabs[scopeId]?.viewId ?? "");
  const presented = useBrowserRuntimeStore((state) => Boolean(viewId && state.presented[agentPageKey(viewId)]));
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!scopeId) return;
    let current = true;
    setClosed(false);
    setShownAgentTab(scopeId);
    void wakeAgentTab(scopeId).then((open) => {
      if (current) setClosed(!open);
    });
    return () => {
      current = false;
      setShownAgentTab(undefined);
    };
  }, [scopeId]);

  useAgentPageGeometry(ref, viewId);

  // While the agent acts, its page takes no input from the person; the ring marks it.
  useEffect(() => {
    if (!viewId) return;
    void invoke("browser_agent_set_locked", { request: { id: viewId }, locked, ring: locked }).catch(() => undefined);
  }, [viewId, locked]);

  return (
    <div className="agent-browser-page" data-browser-corner-clip="">
      <div
        ref={ref}
        className="agent-browser-page-host"
        data-agent-page-awaiting={presented ? undefined : ""}
      >
        {viewId ? null : closed ? (
          picture ? (
            <img className="agent-browser-page-picture" src={picture} alt="The page's last picture" />
          ) : (
            <p className="agent-browser-page-note">This page is closed.</p>
          )
        ) : (
          <SkeletonDocument label="Page" className="agent-browser-page-skeleton" />
        )}
      </div>
    </div>
  );
}
