import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { usePresentedPageHost } from "@/features/browser";
import { useBrowserRuntimeStore } from "@/features/app-windows";
import { SetupState, Surface, Text } from "@misty/ui";
import { agentTab, setShownAgentTab, wakeAgentTab } from "../tabs/agent_tabs";
import { useAgentBrowser } from "./agent_browser_store";
import { agentPageKey, useAgentPageGeometry } from "./use_agent_page_geometry";

const noteClass = "absolute inset-0 m-0 grid place-items-center";

export function AgentBrowserStage({
  scopeId,
  locked,
  picture,
}: {
  scopeId: string;
  locked: boolean;
  picture?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewId = useAgentBrowser((state) => state.tabs[scopeId]?.viewId ?? "");
  const presented = useBrowserRuntimeStore((state) =>
    Boolean(viewId && state.presented[agentPageKey(viewId)]),
  );
  usePresentedPageHost(agentPageKey(viewId), Boolean(viewId) && presented);
  const [closed, setClosed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [switched, setSwitched] = useState({ scopeId, before: undefined as string | undefined });
  if (switched.scopeId !== scopeId) setSwitched({ scopeId, before: picture });
  const ownPicture = picture && picture !== switched.before ? picture : undefined;
  const blank = useAgentBrowser(
    (state) => !state.tabs[scopeId]?.url && Boolean(agentTab(scopeId)?.byPerson),
  );

  useEffect(() => {
    if (!scopeId) return;
    let current = true;
    setClosed(false);
    setShownAgentTab(scopeId);
    if (!blank)
      void wakeAgentTab(scopeId, ref.current).then(
        (open) => {
          if (current) setClosed(!open);
        },
        () => {
          if (current) setClosed(true);
        },
      );
    return () => {
      current = false;
      setShownAgentTab(undefined);
    };
  }, [scopeId, blank, attempt]);

  useAgentPageGeometry(ref, viewId, { handoff: true });

  useEffect(() => {
    if (!viewId) return;
    void invoke("browser_agent_set_locked", {
      request: { id: viewId },
      locked,
      ring: locked,
    }).catch(() => undefined);
  }, [viewId, locked]);

  return (
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
          <div className="absolute inset-0">
            <SetupState tool="browser" onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        )}
      </Surface>
    </Surface>
  );
}
