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
import { Button, cn, OverflowFadeText, Text } from "@/shared/ui";
import { HomeSectionHead } from "./HomeSection";
import { homeAgentsClass, homePairClass, homeSectionClass } from "./homeLayout";
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
import { RecentlyEditedCard } from "./RecentlyEditedCard";
import type { GalleryItem } from "./galleryItems";
import { useRuns } from "./useOverviewData";
import { useNow } from "@/shared/hooks/useNow";

/**
 * The middle of a Space's home: what is waiting for the person, their agents and what each is
 * doing, their latest chats beside what they left to pick up, and the folders this Space works in
 * beside what was edited last.
 */
export function SpaceOverview({
  spaceId,
  solo,
  items,
  itemsLoading,
}: {
  spaceId: string;
  /** Only the person is in this Space, so what they save in it is private. */
  solo: boolean;
  /** The Space's docs, drawings and files, for the recently edited panel. */
  items: GalleryItem[];
  itemsLoading: boolean;
}) {
  const now = useNow();
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
    <Button type="button" variant="quiet" icon={Plus} onClick={() => navigate("/agents")}>
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
                  <OverflowFadeText full>{name(run.agentId)}</OverflowFadeText>
                  <span aria-hidden="true">·</span>
                  <Text bare tone="waiting" className="inline-flex shrink-0 items-center gap-1.5">
                    {run.asks}
                  </Text>
                </>
              }
              trailing={
                <>
                  {shortAgo(run.updatedAt, now)}
                  <ChevronRight aria-hidden="true" />
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
        className={homeSectionClass}
        heading={<HomeSectionHead title="Happening now" />}
        onOpenChat={({ agentId, conversationId }) => navigate(chatHref(agentId, conversationId))}
      />
      <AgentsNow
        className={cn(homeSectionClass, homeAgentsClass)}
        heading={<HomeSectionHead title="Agents" />}
        onOpenChat={(agentId, conversationId) => navigate(chatHref(agentId, conversationId))}
      />
      <div className={homePairClass}>
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
                    <OverflowFadeText full>{name(chat.agentId)}</OverflowFadeText>
                    <OverviewStatus status={statuses[chat.id]} />
                  </>
                }
                trailing={shortAgo(chat.updatedAt, now)}
                onOpen={() =>
                  navigate(chatHref(agentOf(agents, chat.agentId)?.id ?? chat.agentId, chat.id))
                }
              />
            ))
          ) : (
            <OverviewEmpty>No chats yet</OverviewEmpty>
          )}
        </OverviewCard>
        <PickUpsCard spaceId={spaceId} solo={solo} chats={recent} />
        {/* Panels come in pairs: the folders sit beside what was edited last, never alone
            across the whole row. */}
        <ProjectFoldersCard />
        <RecentlyEditedCard items={items} loading={itemsLoading} />
      </div>
    </>
  );
}
