import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { IconButton, Pressable } from "@/shared/ui";
import "./agentBrowser.css";
import { closeAgentBrowser, showView, useAgentBrowser } from "./agentBrowserStore";
import { statusWord } from "./AgentViewSwitcher";

/**
 * The open chat's agent browser as a picture at the top of the chat:
 * a picture refreshed after each step and each load, never a live page. A live page is a native
 * view drawn above the whole app, so in a frame this small it could not be clipped by the chat,
 * covered by a menu or share its page with the split without the two fighting over it.
 * With several views it flips between them. Clicking it expands the full split; the close button
 * puts it away until the agent opens another page.
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
  if (!chat?.views.length || chat.hidden || (chat.expanded && !always)) return null;
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
      <Pressable
        className="agent-browser-pip-picture"
        aria-label="Open the agent browser"
        onClick={onExpand}
      >
        {view.picture ? (
          <img src={view.picture} alt="" draggable={false} />
        ) : (
          <span className="agent-view-blank" />
        )}
      </Pressable>
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
        <span className="agent-browser-pip-actions">
          <IconButton label="Open the agent browser" onClick={onExpand}>
            <Maximize2 />
          </IconButton>
          <IconButton
            label="Close the agent browser"
            onClick={() => closeAgentBrowser(chat.conversationId)}
          >
            <X />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
