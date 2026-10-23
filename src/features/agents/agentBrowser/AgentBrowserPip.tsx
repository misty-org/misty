import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "@/shared/ui";
import "./agentBrowser.css";
import { showView, useAgentBrowser } from "./agentBrowserStore";
import { statusWord } from "./AgentViewSwitcher";
import { AgentBrowserStage } from "./AgentBrowserStage";

/** The width the page is laid out at, as a desktop page, before it is shown small. */
const DESKTOP_WIDTH = 1280;

/**
 * The live page in a small frame: the native page is placed over the frame like in the split and
 * zoomed out so it lays out at desktop width, a real page at a small size, not a crop of one.
 */
function LivePipPage({ scopeId, locked }: { scopeId: string; locked: boolean }) {
  const viewId = useAgentBrowser((state) => state.tabs[scopeId]?.viewId ?? "");
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element || !viewId) return;
    const apply = () => {
      const factor = Math.min(1, Math.max(0.2, element.clientWidth / DESKTOP_WIDTH));
      void invoke("browser_webview_set_zoom", { request: { id: viewId, factor } }).catch(
        () => undefined,
      );
    };
    const resize = new ResizeObserver(apply);
    resize.observe(element);
    // The page may open after the frame is measured.
    const timers = [300, 1200].map((delay) => window.setTimeout(apply, delay));
    apply();
    return () => {
      resize.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      void invoke("browser_webview_set_zoom", { request: { id: viewId, factor: 1 } }).catch(
        () => undefined,
      );
    };
  }, [viewId]);
  return (
    <div ref={frame} className="agent-browser-pip-picture agent-browser-pip-live">
      <AgentBrowserStage scopeId={scopeId} locked={locked} />
    </div>
  );
}

/**
 * The open chat's agent browser as a picture at the top of the chat (docs/design/agent-browser/
 * BRIEF.md): a picture refreshed after each step, never a live page. With several views it flips
 * between them. Clicking it expands the full split.
 *
 * It lives inside the conversation view, so it stays within the chat and is gone once the person
 * leaves it; there is no OS window that could float outside.
 *
 * `always` shows it even while the split is open: the side panel has no room for the split.
 */
export function AgentBrowserPip({
  conversationId,
  onExpand,
  always = false,
}: {
  conversationId?: string;
  onExpand: () => void;
  always?: boolean;
}) {
  const chat = useAgentBrowser((state) =>
    conversationId ? state.chats[conversationId] : undefined,
  );
  if (!chat?.views.length || (chat.expanded && !always)) return null;
  const index = Math.max(
    0,
    chat.views.findIndex((view) => view.id === chat.shownView),
  );
  const view = chat.views[index]!;
  const flip = (step: number) =>
    showView(
      chat.conversationId,
      chat.views[(index + step + chat.views.length) % chat.views.length]!.id,
    );
  return (
    <div className="agent-browser-pip">
      <LivePipPage scopeId={view.shownScope} locked={view.status === "working"} />
      <div className="agent-browser-pip-foot">
        <span className="agent-view-label">{view.label}</span>
        <span className="agent-view-status" data-working={view.status === "working" || undefined}>
          {statusWord[view.status]}
        </span>
        <IconButton
          label="Open the agent browser"
          onClick={onExpand}
          className="agent-browser-pip-expand"
        >
          <Maximize2 />
        </IconButton>
        {chat.views.length > 1 && (
          <span className="agent-browser-pip-flip">
            <IconButton label="Previous view" onClick={() => flip(-1)}>
              <ChevronLeft />
            </IconButton>
            <span>
              {index + 1} of {chat.views.length}
            </span>
            <IconButton label="Next view" onClick={() => flip(1)}>
              <ChevronRight />
            </IconButton>
          </span>
        )}
      </div>
    </div>
  );
}
