import { Pressable } from "@/shared/ui";
import { showView, type AgentBrowserChat, type AgentViewStatus } from "./agentBrowserStore";

export const statusWord: Record<AgentViewStatus, string> = { working: "Working", waiting: "Waiting", done: "Done" };

/** A chat's views as small pictures with their labels and status words; one shows at a time. */
export function AgentViewSwitcher({ chat }: { chat: AgentBrowserChat }) {
  if (chat.views.length < 2) return null;
  return (
    <div className="agent-view-switcher" role="tablist" aria-label="Views">
      {chat.views.map((view) => (
        <Pressable
          key={view.id}
          role="tab"
          aria-selected={view.id === chat.shownView}
          className="agent-view"
          onClick={() => showView(chat.conversationId, view.id)}
        >
          {view.picture ? <img src={view.picture} alt="" /> : <span className="agent-view-blank" />}
          <span className="agent-view-label">{view.label}</span>
          <span className="agent-view-status" data-working={view.status === "working" || undefined}>
            {statusWord[view.status]}
          </span>
        </Pressable>
      ))}
    </div>
  );
}
