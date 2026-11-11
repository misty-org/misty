import { CalendarClock, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentAvatar,
  AgentsNow,
  conversationInSpace,
  describeNextRun,
  shortAgo,
  useChatStatuses,
  useMistyStore,
  usePersonalAgentsStore,
  useWorkflowSchedulesStore,
} from "@/features/agents";
import { Button } from "@/shared/ui";
import { OverviewCard, OverviewRow, OverviewRowsSkeleton, OverviewStatus } from "./OverviewCard";
import { agentOf, chatHref, chatTitle, recentChats, waitingRuns } from "./overviewData";
import { ProjectFoldersCard } from "./ProjectFoldersCard";
import { useRuns } from "./useOverviewData";

const scheduledShown = 4;

/**
 * The top of a Space's home: the person's agents and what each is doing, what is waiting for the
 * person, their latest chats, the folders this Space works in and what is scheduled next.
 */
export function SpaceOverview({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const conversations = useMistyStore((state) => state.conversations);
  const chatsLoading = useMistyStore((state) => state.conversationsLoading);
  const statuses = useChatStatuses();
  const runs = useRuns();
  const schedules = useWorkflowSchedulesStore((state) => state.runs);
  const account = useWorkflowSchedulesStore((state) => state.accountId);
  useEffect(() => {
    if (account) void useWorkflowSchedulesStore.getState().load();
  }, [account]);

  const chats = useMemo(
    () => conversations.filter((conversation) => conversationInSpace(conversation)),
    // The window's Space decides which chats count, so a change of Space reads them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, spaceId],
  );
  const waiting = useMemo(() => waitingRuns(runs ?? [], chats), [runs, chats]);
  const recent = useMemo(() => recentChats(chats), [chats]);
  const upcoming = schedules.filter((run) => run.enabled).slice(0, scheduledShown);
  const name = (agentId: string | undefined) => agentOf(agents, agentId)?.name ?? "Agent";
  const avatar = (agentId: string | undefined) => (
    <AgentAvatar agent={agentOf(agents, agentId)} compact />
  );

  return (
    <div className="space-overview">
      <AgentsNow
        onOpenChat={(agentId, conversationId) => navigate(chatHref(agentId, conversationId))}
      />
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
      <div className="space-overview-grid">
        <OverviewCard title="Recent chats">
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
            <div className="overview-card-empty">
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/agents")}>
                <Plus aria-hidden="true" />
                New chat
              </Button>
            </div>
          )}
        </OverviewCard>
        <ProjectFoldersCard />
        {upcoming.length > 0 && (
          <OverviewCard title="Scheduled work">
            {upcoming.map((run) => (
              <OverviewRow
                key={run.id}
                kind="schedule"
                leading={<CalendarClock className="size-4" aria-hidden="true" />}
                title={run.title || "Workflow"}
                detail={<span className="truncate">{name(run.agent_id)}</span>}
                trailing={describeNextRun(run)}
                onOpen={() => navigate(chatHref(run.agent_id, run.conversation_id ?? ""))}
              />
            ))}
          </OverviewCard>
        )}
      </div>
    </div>
  );
}
