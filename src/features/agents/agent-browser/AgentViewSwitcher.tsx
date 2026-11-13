import { Pressable, Surface, Text } from "@/shared/ui";
import { showView, type AgentBrowserChat, type AgentViewStatus } from "./agentBrowserStore";

export const statusWord: Record<AgentViewStatus, string> = {
  working: "Working",
  waiting: "Waiting",
  done: "Done",
};

// The label and status take their role's font size alone and keep the line height around them,
// so the switcher stays the height the live page under it is placed by.

/** A view's label: one line that fades when long. */
export function AgentViewLabel({ children }: { children: string }) {
  return (
    <Text tone="default" className="max-w-30 text-(length:--text-caption)">
      {children}
    </Text>
  );
}

/** A view's status word, brighter while the agent works in it. */
export function AgentViewStatusWord({ status }: { status: AgentViewStatus }) {
  return (
    <Text
      bare
      tone={status === "working" ? "default" : "muted"}
      className="text-(length:--text-micro)"
    >
      {statusWord[status]}
    </Text>
  );
}

/** A chat's views as small pictures with their labels and status words; one shows at a time. */
export function AgentViewSwitcher({ chat }: { chat: AgentBrowserChat }) {
  if (chat.views.length < 2) return null;
  return (
    // Its height is part of the page's place: the live page sits under it (agent browser stage).
    <div className="flex shrink-0 gap-1" role="tablist" aria-label="Views">
      {chat.views.map((view) => {
        const selected = view.id === chat.shownView;
        return (
          <Surface
            as={Pressable}
            key={view.id}
            role="tab"
            aria-selected={selected}
            tone={selected ? "card" : "none"}
            wash={selected ? undefined : "card"}
            radius="md"
            className="grid grid-cols-[2.25rem_auto] grid-rows-[auto_auto] items-center gap-x-2 py-0.75 pr-2 pl-0.75 text-left"
            onClick={() => showView(chat.conversationId, view.id)}
          >
            <Surface tone="card" radius="sm" className="row-span-2 h-6 w-9 overflow-hidden">
              {view.picture ? (
                <img
                  src={view.picture}
                  alt=""
                  className="block size-full object-cover object-top"
                />
              ) : null}
            </Surface>
            <AgentViewLabel>{view.label}</AgentViewLabel>
            <AgentViewStatusWord status={view.status} />
          </Surface>
        );
      })}
    </div>
  );
}
