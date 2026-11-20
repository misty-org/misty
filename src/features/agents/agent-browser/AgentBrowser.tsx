import { invoke } from "@tauri-apps/api/core";
import { Globe, Hand, MousePointerClick, PictureInPicture2, Play, ScrollText } from "lucide-react";
import { useState } from "react";
import { aiSurfaceApi } from "../runs/invocations/api";
import { BrowserNavigationButtons } from "@/features/browser";
import { Button, IconButton, Input, SidePanelHeader } from "@misty/ui";
import { AgentBrowserStage } from "./AgentBrowserStage";
import { AgentBrowserTabs } from "./AgentBrowserTabs";
import { AgentViewSwitcher } from "./AgentViewSwitcher";
import { browserAddress } from "../context-panel/browserAddress";
import { hostAddress } from "./hostAddress";
import { navigateShownTab } from "../tabs/agentPersonTabs";
import { agentTab } from "../tabs/agentTabs";
import { detachAgentBrowser, useAgentBrowser } from "./agentBrowserStore";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { BrowserLog } from "../browser-log/BrowserLog";
import { closeBrowserLog, openBrowserLog, useBrowserLog } from "../browser-log/browserLogStore";
import { PickedElementCard } from "./PickedElementCard";
import { useElementPick } from "./useElementPick";

/**
 * The agent browser in the chat's side panel: a small copy of Misty's own browser beside the
 * open chat. Its views' switcher sits above; the shown view's tabs are on top, then back, forward
 * and reload with the address; the page fills the rest. The
 * person reads and scrolls; while the agent acts, its page takes no input until they take over.
 */
export function AgentBrowser({ conversationId }: { conversationId?: string }) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  const tabs = useAgentBrowser((state) => state.tabs);
  // The run whose page the person holds; a later run, or the same one ended, isn't held.
  const [heldRun, setHeldRun] = useState<string>();
  const view = chat?.views.find((item) => item.id === chat.shownView) ?? chat?.views[0];
  const shown = view ? tabs[view.shownScope] : undefined;
  const elementPick = useElementPick(shown?.viewId ?? "", shown?.url, Boolean(shown?.loading));
  const log = useBrowserLog((state) => (conversationId ? state.chats[conversationId] : undefined));
  // The run's browser log takes the page's place, even after the run's tabs have closed.
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
    // Only a run that is really held hands its page over.
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
      {/* Only a tab showing the person's own local app can be picked from. */}
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
  // The address field: the site of a secure page at rest, the full address while typing. The person
  // can send the shown tab anywhere unless the agent is acting on it.
  const address = (
    <AddressField
      key={view.shownScope}
      url={shown?.url ?? ""}
      autoFocus={blank}
      disabled={locked}
      onGo={(url) => void navigateShownTab(view.shownScope, url)}
    />
  );
  // The panel around it has the close button; shrinking to a picture is the browser's own.
  const foot = (
    <IconButton label="Shrink to a picture" onClick={() => detachAgentBrowser(chat.conversationId)}>
      <PictureInPicture2 />
    </IconButton>
  );
  return (
    // Its gaps and padding are the page's: the live page is placed over the stage's measured box.
    // The sidebar card's head starts after the window buttons; here it is far from them.
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 p-1.5 [--shell-tab-height:1.875rem] [--window-chrome-left:0px]"
      aria-label="Agent browser"
    >
      <AgentViewSwitcher chat={chat} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/* The tabs are the panel's header row, beside its widen and close, as a browser's tab
            strip sits beside its window buttons. Travel, the address and the hands go under them. */}
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
      className="min-w-0 flex-1 px-3 text-sm"
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
