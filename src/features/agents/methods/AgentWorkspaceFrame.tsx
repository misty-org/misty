import { useEffect, useLayoutEffect, useRef, type ComponentType, type ReactNode } from "react";
import type { MistyActivityEntry } from "../conversations/state/activity";
import type { AgentProfile } from "@/shared/schemas";
import { useSessionGoalRunner } from "../goals/session_goals";
import { ContextRail } from "../context-panel/ContextRail";
import { useRailShown } from "../context-panel/rail_layout_store";
import { ChatSessionCard, useAgentChatSidePanel } from "../context-panel/ChatSidePanels";
import { CHAT_MIN_WIDTH } from "../context-panel/context_panel_store";
import { isUnread, markConversationRead } from "./conversation_reads";
import { FramedPage, Separator, Surface } from "@misty/ui";
import { createPort } from "@/shared/lib/seams";

export const filesPage = createPort<ComponentType>("the Files page");

function FilesPageSlot() {
  const Page = filesPage.maybe();
  return Page ? <Page /> : null;
}

const isRunInProgress = (state?: string) => state === "running" || state === "queued";

export type AgentWorkspacePage = "task" | "files";
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
  header,
  children,
  onNewTask,
  theirs,
}: {
  agent: AgentProfile;
  accountId: string;
  page: AgentWorkspacePage;
  conversations: RecentConversation[];
  activity: MistyActivityEntry[];
  conversationId: string;
  disabled: boolean;
  header?: ReactNode;
  children: ReactNode;
  onNewTask(): void;
  theirs?: ReactNode;
}) {
  const chatPageRef = useRef<HTMLDivElement>(null);
  const sidePanel = useAgentChatSidePanel({
    conversationId,
    agent,
    accountId,
    active: page === "task",
  });
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
      className="agent-studio @container/agent-studio flex h-full min-h-0 min-w-0 flex-1 flex-row"
      data-page={page}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <FramedPage
          autoSaveId="agent-chat"
          workMinWidth={CHAT_MIN_WIDTH}
          header={page === "task" ? header : undefined}
        >
          <div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              ref={chatPageRef}
              className="flex h-full min-w-0"
              hidden={page !== "task" || Boolean(theirs)}
            >
              {children}
            </div>
            {page === "task" && theirs ? theirs : null}
            {page === "task" && !theirs ? (
              <ChatSessionCard conversationId={conversationId} agent={agent} />
            ) : null}
            {page === "task" && !theirs ? sidePanel : null}
            {page === "files" ? <FilesPageSlot /> : null}
          </div>
        </FramedPage>
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
