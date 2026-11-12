import { invoke } from "@tauri-apps/api/core";
import { Hand, PictureInPicture2, Play, X } from "lucide-react";
import { useState } from "react";
import { aiSurfaceApi } from "../runs/invocations/api";
import { BrowserNavigationButtons } from "@/features/browser";
import { Button, IconButton, Input, Tooltip } from "@/shared/ui";
import "./agentBrowser.css";
import { AgentBrowserStage } from "./AgentBrowserStage";
import { AgentBrowserTabs } from "./AgentBrowserTabs";
import { AgentViewSwitcher } from "./AgentViewSwitcher";
import { browserAddress } from "../context-panel/browserAddress";
import { hostAddress } from "./hostAddress";
import { openPersonTab } from "../tabs/agentPersonTabs";
import { agentTab } from "../tabs/agentTabs";
import { closeAgentBrowser, setBrowserExpanded, useAgentBrowser } from "./agentBrowserStore";

/**
 * The agent browser in the full split: a small copy of
 * Misty's own browser beside the open chat. Its views' switcher sits above; the side card holds
 * back, forward and reload, the address and the shown view's tabs; the page fills the rest. The
 * person reads and scrolls; while the agent acts, its page takes no input until they take over.
 */
export function AgentBrowser({ conversationId }: { conversationId?: string }) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  const tabs = useAgentBrowser((state) => state.tabs);
  const [takenOver, setTakenOver] = useState(false);
  if (!chat?.expanded || chat.hidden || !chat.views.length) return null;
  const view = chat.views.find((item) => item.id === chat.shownView) ?? chat.views[0]!;
  const shown = tabs[view.shownScope];
  const runId = agentTab(view.shownScope)?.runId;
  const working = view.status === "working";
  const locked = working && !takenOver;
  const page = shown?.viewId ?? "";
  const blank = Boolean(agentTab(view.shownScope)?.byPerson && !shown?.url);
  const hold = async (takeOver: boolean) => {
    if (!runId) return;
    if (takeOver) await aiSurfaceApi.pauseInvocation(runId);
    else await aiSurfaceApi.resumeInvocation(runId);
    setTakenOver(takeOver);
  };
  const run = (command: string) => {
    if (page) void invoke(command, { request: { id: page } }).catch(() => undefined);
  };
  const head = (
    <>
      <BrowserNavigationButtons
        canGoBack={!locked && Boolean(page)}
        canGoForward={!locked && Boolean(page)}
        showStop={!locked && Boolean(shown?.loading)}
        reloadDisabled={locked || !page}
        onTravel={(direction) =>
          run(direction < 0 ? "browser_webview_back" : "browser_webview_forward")
        }
        onStop={() => run("browser_webview_stop")}
        onReload={() => run("browser_webview_reload")}
      />
    </>
  );
  const hands = (
    <>
      {working && !takenOver && (
        <IconButton label="Take over" onClick={() => void hold(true)}>
          <Hand />
        </IconButton>
      )}
      {takenOver && (
        <Button variant="primary" icon={Play} onClick={() => void hold(false)}>
          Resume
        </Button>
      )}
    </>
  );
  // The address field at rest: the site of a secure page, the full address otherwise.
  const address = (
    <>
      {blank ? (
        <Input
          autoFocus
          placeholder="Search Google or type an address for the agent"
          aria-label="Page address"
          variant="address"
          className="h-8 min-w-0 flex-1 rounded-lg px-3 text-left text-sm"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const address = browserAddress(event.currentTarget.value);
            if (address) void openPersonTab(view.shownScope, address);
          }}
        />
      ) : (
        <Tooltip content={shown?.url}>
          <Input
            readOnly
            value={shown?.url ? hostAddress(shown.url) : ""}
            aria-label="Page address"
            variant="address"
            className="h-8 min-w-0 flex-1 rounded-lg px-3 text-left text-sm"
          />
        </Tooltip>
      )}
    </>
  );
  const foot = (
    <>
      <span />
      <IconButton
        label="Shrink to a picture"
        onClick={() => setBrowserExpanded(chat.conversationId, false)}
      >
        <PictureInPicture2 />
      </IconButton>
      <IconButton
        label="Close the agent browser"
        onClick={() => closeAgentBrowser(chat.conversationId)}
      >
        <X />
      </IconButton>
    </>
  );
  return (
    <section className="agent-browser" aria-label="Agent browser">
      <AgentViewSwitcher chat={chat} />
      <div className="agent-browser-body">
        <AgentBrowserTabs conversationId={chat.conversationId} view={view} />
        <div className="agent-browser-toolbar">
          {head}
          {address}
          {hands}
          {foot}
        </div>
        <AgentBrowserStage scopeId={view.shownScope} locked={locked} picture={view.picture} />
      </div>
    </section>
  );
}
