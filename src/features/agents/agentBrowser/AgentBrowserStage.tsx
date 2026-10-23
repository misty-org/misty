import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { usePresentedPageHost } from "@/features/browser";
import { useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { SkeletonDocument } from "@/shared/ui";
import { agentTab, setShownAgentTab, wakeAgentTab } from "../agentTabs";
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
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(viewId && state.presented[agentPageKey(viewId)]),
  );
  // The same transparent path a browser tab's page host turns on while its page is on screen
  // (theme.css): the page shows through a popup or menu, and never flashes an opaque host.
  usePresentedPageHost(agentPageKey(viewId), Boolean(viewId) && presented);
  const [closed, setClosed] = useState(false);
  // A tab the person just added waits for an address; nothing opens until they give one.
  const blank = useAgentBrowser(
    (state) => !state.tabs[scopeId]?.url && Boolean(agentTab(scopeId)?.byPerson),
  );

  useEffect(() => {
    if (!scopeId) return;
    let current = true;
    setClosed(false);
    setShownAgentTab(scopeId);
    if (!blank)
      void wakeAgentTab(scopeId).then((open) => {
        if (current) setClosed(!open);
      });
    return () => {
      current = false;
      setShownAgentTab(undefined);
    };
  }, [scopeId, blank]);

  useAgentPageGeometry(ref, viewId);

  // While the agent acts, its page takes no input from the person; Misty's pulsing mist over the page marks it; the tab strip and toolbar stay the person's.
  useEffect(() => {
    if (!viewId) return;
    void invoke("browser_agent_set_locked", {
      request: { id: viewId },
      locked,
      ring: locked,
    }).catch(() => undefined);
  }, [viewId, locked]);

  return (
    <div className="agent-browser-page" data-browser-corner-clip="">
      <div
        ref={ref}
        className="agent-browser-page-host"
        data-browser-page-host=""
        data-browser-page-awaiting={viewId && !presented ? "" : undefined}
        data-browser-page-presented={viewId && presented ? "" : undefined}
        data-agent-page-awaiting={presented ? undefined : ""}
      >
        {viewId ? null : blank ? (
          <p className="agent-browser-page-note">Open a URL for the agent to use</p>
        ) : closed ? (
          picture ? (
            <img
              className="agent-browser-page-picture"
              src={picture}
              alt="The page's last picture"
            />
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
