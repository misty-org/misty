import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { usePresentedPageHost } from "@/features/browser";
import { useBrowserRuntimeStore } from "@/features/app-windows";
import { SkeletonDocument, Surface, Text } from "@/shared/ui";
import { agentTab, setShownAgentTab, wakeAgentTab } from "../tabs/agentTabs";
import { useAgentBrowser } from "./agentBrowserStore";
import { agentPageKey, useAgentPageGeometry } from "./useAgentPageGeometry";

/** A word over the page area, centered in it. */
const noteClass = "absolute inset-0 m-0 grid place-items-center";

/**
 * The agent browser's page area: the agent's live page is placed over it by the page runtime,
 * and until that page is on screen
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
  /** The view's last picture: shown while the page wakes, and for a page that cannot open again. */
  picture?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewId = useAgentBrowser((state) => state.tabs[scopeId]?.viewId ?? "");
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(viewId && state.presented[agentPageKey(viewId)]),
  );
  // The window's transparent path is on while the page is on screen (theme.css): the page shows
  // through a popup or menu, and never flashes an opaque host.
  usePresentedPageHost(agentPageKey(viewId), Boolean(viewId) && presented);
  const [closed, setClosed] = useState(false);
  // The picture is of the tab shown last: after a switch, the one taken before it belongs to the
  // tab left behind, so only a picture taken since stands in for this one.
  const [switched, setSwitched] = useState({ scopeId, before: undefined as string | undefined });
  if (switched.scopeId !== scopeId) setSwitched({ scopeId, before: picture });
  const ownPicture = picture && picture !== switched.before ? picture : undefined;
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

  useAgentPageGeometry(ref, viewId, { handoff: true });

  // While the agent acts, its page takes no input from the person; Misty's pulsing mist over the
  // page marks it. The tab strip and toolbar stay the person's.
  useEffect(() => {
    if (!viewId) return;
    void invoke("browser_agent_set_locked", {
      request: { id: viewId },
      locked,
      ring: locked,
    }).catch(() => undefined);
  }, [viewId, locked]);

  return (
    // A rounded pane like a tab's, the page's corners cut to it (browserHostBounds.ts). It has no
    // fill of its own: the host covers it, painting the page's color until the page is on screen
    // and nothing once it is, so the native page shows beneath the renderer under a popup.
    <Surface
      tone="none"
      radius="lg"
      className="min-h-0 min-w-0 flex-1 overflow-hidden"
      data-browser-corner-clip=""
    >
      <Surface
        ref={ref}
        tone={presented ? "none" : "page"}
        className="relative size-full"
        data-browser-page-host=""
        data-browser-page-awaiting={viewId && !presented ? "" : undefined}
        data-browser-page-presented={viewId && presented ? "" : undefined}
        data-agent-page-awaiting={presented ? undefined : ""}
      >
        {/* Until the live page is on screen, its last picture stands in for it: while the tab
            wakes, and for good once it can't open again. Only a page never seen has a skeleton. */}
        {presented ? null : blank && !viewId ? (
          <Text bare as="p" size="meta" tone="muted" className={noteClass}>
            Open a URL for the agent to use
          </Text>
        ) : ownPicture ? (
          <img
            className="block size-full object-cover object-top"
            src={ownPicture}
            alt="The page's last picture"
          />
        ) : viewId ? null : closed ? (
          <Text bare as="p" size="meta" tone="muted" className={noteClass}>
            This page is closed.
          </Text>
        ) : (
          <SkeletonDocument label="Page" className="absolute inset-0" />
        )}
      </Surface>
    </Surface>
  );
}
