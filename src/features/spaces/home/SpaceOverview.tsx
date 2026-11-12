import { ChevronRight, Plus } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentAvatar,
  AgentsNow,
  HappeningNow,
  conversationInSpace,
  currentSpaceKey,
  folderOf,
  useSpaceFolders,
  useSpaceRuns,
  shortAgo,
  useChatStatuses,
  useMistyStore,
  usePersonalAgentsStore,
  useTutorChatIds,
} from "@/features/agents";
import { Button } from "@/shared/ui";
import { HomeSectionHead } from "./HomeSection";
import {
  OverviewCard,
  OverviewEmpty,
  OverviewRow,
  OverviewRowsSkeleton,
  OverviewStatus,
} from "./OverviewCard";
import { agentOf, chatHref, chatTitle, recentChats, waitingRuns } from "./overviewData";
import { PickUpsCard } from "./PickUpsCard";
import { ProjectFoldersCard } from "./ProjectFoldersCard";
import { useRuns } from "./useOverviewData";

/**
 * The middle of a Space's home: what is waiting for the person, their agents and what each is
 * doing, and their latest chats beside the folders this Space works in.
 */
export function SpaceOverview({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const chatsLoading = useMistyStore((state) => state.conversationsLoading);
  const statuses = useChatStatuses();
  const runs = useRuns();

  // Tutor's own chats (lessons, notebook questions, studio runs) live in Tutor, not here.
  const tutorChats = useTutorChatIds();
  const chats = useMemo(
    () =>
      conversations.filter(
        (conversation) => conversationInSpace(conversation) && !tutorChats.has(conversation.id),
      ),
    // The window's Space decides which chats count, so a change of Space reads them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, spaceId, tutorChats],
  );
  const waiting = useMemo(() => waitingRuns(runs ?? [], chats), [runs, chats]);
  const ownRuns = useSpaceRuns(30);
  const folder = useSpaceFolders((state) => folderOf(state, currentSpaceKey()));
  const recent = useMemo(() => recentChats(chats), [chats]);
  const name = (agentId: string | undefined) => agentOf(agents, agentId)?.name ?? "Agent";
  const avatar = (agentId: string | undefined) => (
    <AgentAvatar agent={agentOf(agents, agentId)} compact />
  );

  const newChat = (
    <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/agents")}>
      <Plus aria-hidden="true" />
      New chat
    </Button>
  );

  return (
    <>
      {waiting.length > 0 && (
        <OverviewCard title="Waiting for you" count={waiting.length} tone="attention">
          {waiting.map((run) => (
            <OverviewRow
              key={run.id}
              leading={avatar(run.agentId)}
              title={run.title}
              detail={
                <>
                  <span className="truncate">{name(run.agentId)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="overview-status" data-status="needs-you">
                    {run.asks}
                  </span>
                </>
              }
              trailing={
                <>
                  {shortAgo(run.updatedAt)}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </>
              }
              onOpen={() => navigate(chatHref(run.agentId, run.conversationId))}
            />
          ))}
        </OverviewCard>
      )}
      <HappeningNow
        runs={ownRuns.runs}
        chats={ownRuns.chats}
        folder={folder}
        className="home-section"
        heading={<HomeSectionHead title="Happening now" />}
        onOpenChat={({ agentId, conversationId }) => navigate(chatHref(agentId, conversationId))}
      />
      <AgentsNow
        className="home-section"
        heading={<HomeSectionHead title="Agents" />}
        onOpenChat={(agentId, conversationId) => navigate(chatHref(agentId, conversationId))}
      />
      <div className="home-pair">
        <OverviewCard title="Recent chats" action={newChat}>
          {chatsLoading && !recent.length ? (
            <OverviewRowsSkeleton rows={3} />
          ) : recent.length ? (
            recent.map((chat) => (
              <OverviewRow
                key={chat.id}
                leading={avatar(chat.agentId)}
                title={chatTitle(chat.title)}
                detail={
                  <>
                    <span className="truncate">{name(chat.agentId)}</span>
                    <OverviewStatus status={statuses[chat.id]} />
                  </>
                }
                trailing={shortAgo(chat.updatedAt)}
                onOpen={() =>
                  navigate(chatHref(agentOf(agents, chat.agentId)?.id ?? chat.agentId, chat.id))
                }
              />
            ))
          ) : (
            <OverviewEmpty>No chats yet</OverviewEmpty>
          )}
        </OverviewCard>
        <PickUpsCard spaceId={spaceId} chats={recent} />
        <ProjectFoldersCard />
      </div>
    </>
  );
}
