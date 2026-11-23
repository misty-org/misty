import { useEffect, useLayoutEffect, useRef, type ComponentType, type ReactNode } from "react";
import type { MistyActivityEntry } from "../conversations/state/activity";
import type { AgentProfile } from "@/shared/schemas";
import { useSessionGoalRunner } from "../goals/session_goals";
import { ContextRail } from "../context-panel/ContextRail";
import { useRailShown } from "../context-panel/rail_layout_store";
import { ChatSessionCard, ChatSidePanels } from "../context-panel/ChatSidePanels";
import { isUnread, markConversationRead } from "./conversation_reads";
import { cn, Separator, Surface } from "@misty/ui";
import { AgentMemoryPage } from "../memory/AgentMemoryPage";
import { createPort } from "@/shared/lib/seams";

const emptyChatClass = cn(
  "[&_.agent-conversation[data-empty=true]]:justify-start",
  "[&_.agent-conversation[data-empty=true]]:pt-[clamp(--spacing(10),18vh,--spacing(52.5))]",
  "[&_.agent-conversation[data-empty=true]]:overflow-y-auto",
  "[&_.agent-conversation[data-empty=true]]:overscroll-contain",
  "[&_.agent-conversation[data-empty=true]_.agent-conversation-scroll]:flex-none",
  "[&_.agent-conversation[data-empty=true]_.agent-conversation-scroll]:overflow-visible",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:mx-auto",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:my-0",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:w-168",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:max-w-[calc(100%-var(--spacing)*12)]",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:shrink-0",
  "[&_.agent-conversation[data-empty=true]_.agent-compose-area]:p-0",
);

export const filesPage = createPort<ComponentType>("the Files page");

function FilesPageSlot() {
  const Page = filesPage.maybe();
  return Page ? <Page /> : null;
}

const isRunInProgress = (state?: string) => state === "running" || state === "queued";

export type AgentWorkspacePage = "task" | "files" | "memory";
type RecentConversation = {
  id: string;
  title?: string;
  folderId?: string;
  updatedAt: string;
  lastReadAt?: string;
};

export function AgentWorkspaceFrame({
  agent,
  accountId,
  page,
  conversations,
  activity,
  conversationId,
  disabled,
  children,
  onNewTask,
}: {
  agent: AgentProfile;
  accountId: string;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  activity: MistyActivityEntry[];
  conversationId: string;
  disabled: boolean;
  children: ReactNode;
  onNewTask(): void;
}) {
  const chatPageRef = useRef<HTMLDivElement>(null);
  const activeId = page === "task" ? conversationId : undefined;
  let latest: MistyActivityEntry | undefined;
  for (const entry of activity) {
    if (entry.parent_run_id || entry.conversation_id !== activeId) continue;
    if (!latest || entry.updated_at > latest.updated_at) latest = entry;
  }
  const lastReadAt = conversations.find((item) => item.id === activeId)?.lastReadAt;
  const readable = Boolean(
    latest && isUnread(latest.updated_at, lastReadAt) && !isRunInProgress(latest.state),
  );
  useEffect(() => {
    if (!activeId || !readable) return;
    const read = () => {
      if (document.visibilityState === "visible") markConversationRead(activeId);
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [activeId, readable]);
  useLayoutEffect(() => {
    if (page !== "task") return;
    const scroll = chatPageRef.current?.querySelector<HTMLElement>(".agent-conversation-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [page, conversationId]);
  useSessionGoalRunner(activeId ?? "");
  const railShown = useRailShown((state) => state.value);
  return (
    <div
      className={cn(
        "agent-studio @container/agent-studio flex h-full min-h-0 min-w-0 flex-1 flex-row",
        emptyChatClass,
      )}
      data-page={page}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 min-w-0 flex-1 gap-0">
          <Surface tone="page" className="relative isolate min-h-0 min-w-90 flex-1 overflow-hidden">
            <div ref={chatPageRef} className="flex h-full min-w-0" hidden={page !== "task"}>
              {children}
            </div>
            {page === "task" ? (
              <ChatSessionCard conversationId={conversationId} agent={agent} />
            ) : null}
            {page === "files" ? <FilesPageSlot /> : null}
            {page === "memory" ? (
              <AgentMemoryPage
                accountId={accountId}
                agentId={agent.id}
                agentName={agent.name}
                engine={agent.engine}
                conversationId={conversationId}
              />
            ) : null}
          </Surface>
          {page === "task" ? (
            <ChatSidePanels conversationId={conversationId} agent={agent} />
          ) : null}
        </div>
      </div>
      {page === "task" && railShown ? (
        <>
          <Separator orientation="vertical" />
          <Surface tone="sidebar" className="flex min-h-0 flex-none">
            <ContextRail
              conversationId={conversationId}
              disabled={disabled}
              onNewTask={onNewTask}
            />
          </Surface>
        </>
      ) : null}
    </div>
  );
}
