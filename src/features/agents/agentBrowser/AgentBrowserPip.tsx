import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/shared/ui";
import "./agentBrowser.css";
import { showView, useAgentBrowser } from "./agentBrowserStore";
import { statusWord } from "./AgentViewSwitcher";

/**
 * The open chat's agent browser as a picture at the top of the chat (docs/design/agent-browser/
 * BRIEF.md): a picture refreshed after each step, never a live page. With several views it flips
 * between them. Clicking it expands the full split.
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
  const chat = useAgentBrowser((state) => (conversationId ? state.chats[conversationId] : undefined));
  if (!chat?.views.length || (chat.expanded && !always)) return null;
  const index = Math.max(0, chat.views.findIndex((view) => view.id === chat.shownView));
  const view = chat.views[index]!;
  const flip = (step: number) =>
    showView(chat.conversationId, chat.views[(index + step + chat.views.length) % chat.views.length]!.id);
  return (
    <div className="agent-browser-pip">
      <button type="button" className="agent-browser-pip-picture" aria-label={`Open ${view.label} in the agent browser`} onClick={onExpand}>
        {view.picture ? <img src={view.picture} alt="" /> : <span className="agent-view-blank" />}
      </button>
      <div className="agent-browser-pip-foot">
        <span className="agent-view-label">{view.label}</span>
        <span className="agent-view-status" data-working={view.status === "working" || undefined}>
          {statusWord[view.status]}
        </span>
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
