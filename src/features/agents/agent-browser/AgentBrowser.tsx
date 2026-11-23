import { invoke } from "@tauri-apps/api/core";
import { Globe, Hand, MousePointerClick, PictureInPicture2, Play, ScrollText } from "lucide-react";
import { useState } from "react";
import { aiSurfaceApi } from "../runs/invocations/api";
import { BrowserNavigationButtons } from "@/features/browser";
import { Button, IconButton, Input, SidePanelHeader } from "@misty/ui";
import { AgentBrowserStage } from "./AgentBrowserStage";
import { AgentBrowserTabs } from "./AgentBrowserTabs";
import { AgentViewSwitcher } from "./AgentViewSwitcher";
import { browserAddress } from "../context-panel/browser_address";
import { hostAddress } from "./host_address";
import { navigateShownTab } from "../tabs/agent_person_tabs";
import { agentTab } from "../tabs/agent_tabs";
import { detachAgentBrowser, useAgentBrowser } from "./agent_browser_store";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { BrowserLog } from "../browser-log/BrowserLog";
import { closeBrowserLog, openBrowserLog, useBrowserLog } from "../browser-log/browser_log_store";
import { PickedElementCard } from "./PickedElementCard";
import { useElementPick } from "./use_element_pick";

export function AgentBrowser({ conversationId }: { conversationId?: string }) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  const tabs = useAgentBrowser((state) => state.tabs);
  const [heldRun, setHeldRun] = useState<string>();
  const view = chat?.views.find((item) => item.id === chat.shownView) ?? chat?.views[0];
  const shown = view ? tabs[view.shownScope] : undefined;
  const elementPick = useElementPick(shown?.viewId ?? "", shown?.url, Boolean(shown?.loading));
  const log = useBrowserLog((state) => (conversationId ? state.chats[conversationId] : undefined));
  if (log && conversationId) {
    return (
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-1.5"
        aria-label="Browser log"
      >
        {view ? (
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <Button variant="quiet" icon={Globe} onClick={() => closeBrowserLog(conversationId)}>
              Back to the page
            </Button>
          </div>
        ) : null}
        <BrowserLog key={log.runId} runId={log.runId} callId={log.callId} openedAt={log.openedAt} />
      </section>
    );
  }
  if (!chat?.expanded || chat.hidden || !view) return null;
  const runId = agentTab(view.shownScope)?.runId;
  const working = view.status === "working";
  const takenOver = working && Boolean(runId) && heldRun === runId;
  const locked = working && !takenOver;
  const page = shown?.viewId ?? "";
  const blank = Boolean(agentTab(view.shownScope)?.byPerson && !shown?.url);
  const hold = async (takeOver: boolean) => {
    if (!runId) return;
    if (!takeOver) {
      await aiSurfaceApi.resumeInvocation(runId).catch(() => false);
      setHeldRun(undefined);
      return;
    }
    if (await aiSurfaceApi.pauseInvocation(runId).catch(() => false)) setHeldRun(runId);
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
      {elementPick.local && (
        <IconButton
          label={elementPick.picking ? "Cancel picking" : "Pick an element"}
          aria-pressed={elementPick.picking}
          disabled={locked}
          onClick={elementPick.toggle}
        >
          <MousePointerClick />
        </IconButton>
      )}
      {working && runId && !takenOver && (
        <IconButton label="Take over" onClick={() => void hold(true)}>
          <Hand />
        </IconButton>
      )}
      {takenOver && (
        <Button variant="primary" icon={Play} onClick={() => void hold(false)}>
          Resume
        </Button>
      )}
      {runId && (
        <IconButton label="Browser log" onClick={() => openBrowserLog(chat.conversationId, runId)}>
          <ScrollText />
        </IconButton>
      )}
    </>
  );
  const address = (
    <AddressField
      key={view.shownScope}
      url={shown?.url ?? ""}
      autoFocus={blank}
      disabled={locked}
      onGo={(url) => void navigateShownTab(view.shownScope, url)}
    />
  );
  const foot = (
    <IconButton label="Shrink to a picture" onClick={() => detachAgentBrowser(chat.conversationId)}>
      <PictureInPicture2 />
    </IconButton>
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 p-1.5 [--shell-tab-height:calc(var(--spacing)*7.5)] [--window-chrome-left:0px]"
      aria-label="Agent browser"
    >
      <AgentViewSwitcher chat={chat} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <SidePanelHeader>
          <AgentBrowserTabs conversationId={chat.conversationId} view={view} />
        </SidePanelHeader>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {head}
          {address}
          {hands}
          {foot}
        </div>
        <AgentBrowserStage scopeId={view.shownScope} locked={locked} picture={view.picture} />
        {elementPick.pick ? (
          <PickedElementCard
            pick={elementPick.pick}
            sent={elementPick.sent}
            onSend={elementPick.send}
            onClear={elementPick.clear}
          />
        ) : null}
        <ErrorNotice message={elementPick.error} onDismiss={elementPick.dismissError} />
      </div>
    </section>
  );
}

function AddressField(props: {
  url: string;
  autoFocus: boolean;
  disabled: boolean;
  onGo(url: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const atRest = props.url ? hostAddress(props.url) : "";
  return (
    <Input
      autoFocus={props.autoFocus}
      disabled={props.disabled}
      value={draft ?? atRest}
      placeholder="Search Google or type an address"
      aria-label="Page address"
      variant="address"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="min-w-0 flex-1 px-3 text-control"
      onFocus={(event) => {
        setDraft(props.url);
        const field = event.currentTarget;
        requestAnimationFrame(() => field.select());
      }}
      onBlur={() => setDraft(null)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.blur();
          return;
        }
        if (event.key !== "Enter") return;
        const url = browserAddress(event.currentTarget.value);
        if (!url) return;
        props.onGo(url);
        event.currentTarget.blur();
      }}
    />
  );
}
