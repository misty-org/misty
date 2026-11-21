import { useEffect, useLayoutEffect, useRef, type ComponentType, type ReactNode } from "react";
import type { MistyActivityEntry } from "../conversations/state/activity";
import type { AgentProfile } from "@/shared/schemas";
import { useSessionGoalRunner } from "../goals/sessionGoals";
import { ContextRail } from "../context-panel/ContextRail";
import { useRailShown } from "../context-panel/railLayoutStore";
import { ChatSessionCard, ChatSidePanels } from "../context-panel/ChatSidePanels";
import { isUnread, markConversationRead } from "./conversationReads";
import { LabInSpace } from "../tutor/LabInSpace";
import { CodePage } from "../code/CodePage";
import { cn, Surface } from "@misty/ui";
import { AgentMemoryPage } from "../memory/AgentMemoryPage";
import { createPort } from "@/shared/lib/seams";

/**
 * A new chat in the workspace starts a little way down the canvas, its greeting over the composer
 * at a reading width, and the two scroll together instead of the transcript alone.
 */
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

/**
 * The Files page (`/agents?view=files`), Misty's file manager. It lives in `spaces/file-manager`, which agents
 * can't import, so the app provides it once at startup (`src/app/featureSeams.ts`).
 */
export const filesPage = createPort<ComponentType>("the Files page");

/** The Files page, as the seam has it. */
function FilesPageSlot() {
  const Page = filesPage.maybe();
  return Page ? <Page /> : null;
}

/** Queued or working: read state doesn't apply yet. */
const isRunInProgress = (state?: string) => state === "running" || state === "queued";

export type AgentWorkspacePage = "task" | "lab" | "code" | "files" | "memory";
type RecentConversation = {
  id: string;
  title?: string;
  folderId?: string;
  updatedAt: string;
  lastReadAt?: string;
};

/**
 * The Agents page: a chat with its agent, or one of the pages the sidebar opens (the Lab and Code,
 * the editor for the Space's folder). Only the chat has a bar (the chat column draws it, over its
 * conversation) and the context panel for the folder's files, changes and a terminal. The other
 * pages have no title bar, since the sidebar and the tab already name them. The chats are listed
 * in the window's sidebar, so this page has no list of its own. Presentation only: conversation
 * and account actions remain owned by AgentsPage.
 */
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
  /** This agent's runs, to mark the open conversation read once its run settles. */
  activity: MistyActivityEntry[];
  conversationId: string;
  disabled: boolean;
  children: ReactNode;
  onNewTask(): void;
}) {
  const chatPageRef = useRef<HTMLDivElement>(null);
  // The open conversation is read once its run settles while the window is in view.
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
  // Every opened chat starts at its newest reply. Older pages keep their scroll position because
  // the conversation id does not change while they are prepended.
  useLayoutEffect(() => {
    if (page !== "task") return;
    const scroll = chatPageRef.current?.querySelector<HTMLElement>(".agent-conversation-scroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [page, conversationId]);
  useSessionGoalRunner(activeId ?? "");
  // The rail folds away behind Tools in the window's corner until the person opens it.
  const railShown = useRailShown((state) => state.value);
  return (
    // A main column (a body: the chat, under its floating bar, or another view and, when open, the
    // context panel at its right) beside the rail, which runs the page's full height. Bar, chat,
    // panel and rail are one flat sheet: no line parts them. `agent-studio` names the container
    // the page's narrow layouts measure, and stays as the page's hook.
    <div
      className={cn(
        "agent-studio @container/agent-studio flex h-full min-h-0 min-w-0 flex-1 flex-row",
        emptyChatClass,
      )}
      data-page={page}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The chat, then the side panel and the session card, each 8px off the chat. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 gap-0">
          {/* The chat never narrows past 360px: a side panel beside it gives way first. It keeps
              its own stacking inside, so the cards stay on top where they float over it. */}
          <Surface tone="page" className="relative isolate min-h-0 min-w-90 flex-1 overflow-hidden">
            {/* Keep the live conversation mounted while browsing other views; its draft and voice state belong to it. */}
            <div ref={chatPageRef} className="flex h-full min-w-0" hidden={page !== "task"}>
              {children}
            </div>
            {/* The session card floats over the chat's top right, taking none of its width. */}
            {page === "task" ? (
              <ChatSessionCard conversationId={conversationId} agent={agent} />
            ) : null}
            {/* The Lab is a page of the agent's home Space; its tab goes there. */}
            {page === "lab" ? <LabInSpace agent={agent} /> : null}
            {page === "code" ? <CodePage /> : null}
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
          {/* The chat's side panel, between the chat and the rail. */}
          {page === "task" ? (
            <ChatSidePanels conversationId={conversationId} agent={agent} />
          ) : null}
        </div>
      </div>
      {/* The rail runs the page's full height, so its first button sits on the bar's line. Tools in
          the window's corner shows or hides it. */}
      {page === "task" && railShown ? (
        <ContextRail conversationId={conversationId} disabled={disabled} onNewTask={onNewTask} />
      ) : null}
    </div>
  );
}
