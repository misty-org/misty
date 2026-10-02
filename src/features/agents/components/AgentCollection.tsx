import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { observeAccountChanges } from "@/api/accountEvents";
import { runtimeAiApi, useAgentsAuth } from "../AgentsRuntime";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { useEffect, useState } from "react";
import type { AgentProfile } from "@/shared/schemas";
import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  Spinner,
} from "@/shared/ui";
import { MessagesSquare, MoreHorizontal, Plus, CalendarClock, Clock } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { ScheduledCollection } from "@/features/scheduled/ScheduledCollection";
import { useScheduledTasksStore } from "@/features/scheduled";
import { useSearchParams, useNavigate } from "react-router-dom";
import { MistyDashboard } from "./MistyDashboard";

export function AgentCollection({
  agents,
  conversations,
  loading,
  error,
  workingAgentId,
  disabled,
  onSelect,
  onCreate,
  onNewChat,
  onRetry,
  initialSection = "all",
}: {
  agents: AgentProfile[];
  conversations: GlobalAiConversation[];
  loading: boolean;
  error: string;
  workingAgentId?: string;
  disabled: boolean;
  onSelect: (id: string, startNew?: boolean, conversationId?: string) => void;
  onCreate: () => void;
  onNewChat: () => void;
  onRetry: () => void;
  initialSection?: string;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedSection = params.get("view");
  // Old automation links now land on the activity dashboard.
  const section =
    requestedSection === "automations" ? "activity" : requestedSection || initialSection;
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const searchLabel =
    section === "scheduled"
      ? "Search scheduled tasks"
      : section === "activity"
        ? "Search activity"
        : section === "conversations"
          ? "Search conversations"
          : section === "all"
            ? "Search all"
            : "Search agents";
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const { user } = useAgentsAuth();
  const [activity, setActivity] = useState<MistyActivityEntry[]>([]);
  const schedules = useScheduledTasksStore();
  useEffect(() => {
    if (section !== "all") return;
    useScheduledTasksStore.getState().setAccount(user?.id ?? "");
    void useScheduledTasksStore.getState().load();
  }, [section, user?.id]);
  const [statusRevision, setStatusRevision] = useState(0);
  const [statusState, setStatusState] = useState("loading");
  useEffect(() => {
    if (section !== "agents" && section !== "all") return;
    let live = true;
    let revision = 0;
    setActivity([]);
    setStatusState("loading");
    const refresh = async () => {
      const request = ++revision;
      try {
        const result = await runtimeAiApi.activity("", undefined);
        if (live && request === revision) {
          setActivity(result.entries);
          setStatusState("ready");
        }
      } catch {
        if (live && request === revision) setStatusState("unavailable");
      }
    };
    const unsubscribe = observeAccountChanges(user?.id ?? "", ["runs", "invocations"], refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [section, user?.id, statusRevision]);
  const status = (agent: AgentProfile) => {
    if (!agent.enabled) return "Disabled";
    const states = new Set(
      activity.filter((entry) => entry.agent_id === agent.id).map((entry) => entry.state),
    );
    if (states.has("awaiting_approval") || states.has("awaiting_intervention"))
      return "Needs attention";
    if (states.has("running") || workingAgentId === agent.id) return "Working";
    if (states.has("awaiting_device")) return "Waiting for device";
    if (states.has("queued")) return "Queued";
    return statusState === "ready"
      ? "Ready"
      : statusState === "loading"
        ? "Loading status…"
        : "Status unavailable";
  };
  const date = (value: string) =>
    value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  const agentRows = agents.map((agent) => ({
    id: `agent:${agent.id}`,
    agentId: agent.id,
    kind: "Agents",
    timestamp: agent.updated_at,
    title: agent.name,
    icon: (
      <span className="block size-6 [&_.agent-avatar]:!size-6">
        <AgentAvatar agent={agent} />
      </span>
    ),
    category: status(agent),
    metadata: {
      Status: status(agent),
      Agent: agent.name,
      Role: agent.role || "—",
      Model: agent.model_mode === "automatic" ? "Automatic" : agent.model_id || "—",
      Created: date(agent.created_at),
    },
    sortValues: { Created: Date.parse(agent.created_at) },
    updatedAt: agent.updated_at,
    updated: date(agent.updated_at),
    onOpen: () => onSelect(agent.id),
  }));
  const conversationRows = conversations.flatMap((c) => {
    const agent = agents.find((a) => a.id === c.agentId || (!c.agentId && a.system_managed));
    return agent
      ? [
          {
            id: `conversation:${c.id}`,
            kind: "Conversations",
            timestamp: c.updatedAt,
            agentId: undefined,
            title: c.title || "Untitled conversation",
            icon: <MessagesSquare />,
            category: agent.name,
            metadata: {
              Agent: agent.name,
              Model: c.modelId || "Automatic",
              Messages: c.messages?.length ?? 0,
              Created: date(c.createdAt),
            },
            sortValues: { Created: Date.parse(c.createdAt) },
            updatedAt: c.updatedAt,
            updated: date(c.updatedAt),
            onOpen: () => onSelect(agent.id, false, c.id),
          },
        ]
      : [];
  });
  const allRows = [
    ...agentRows,
    ...conversationRows,
    ...activity.map((entry) => ({
      id: `activity:${entry.id}`,
      kind: "Activity",
      timestamp: entry.updated_at,
      agentId: undefined,
      title: entry.title || "Agent task",
      icon: <Clock />,
      category: "Activity",
      metadata: {
        Status: entry.state.replace(/_/g, " "),
        Agent: agents.find((agent) => agent.id === entry.agent_id)?.name || "—",
      },
      updatedAt: entry.updated_at,
      updated: date(entry.updated_at),
      onOpen: () => {
        const next = new URLSearchParams(params);
        next.set("view", "activity");
        next.set("activity", entry.id);
        setParams(next);
        setQuery("");
      },
    })),
    ...(schedules.accountId === user?.id ? schedules.tasks : []).map((task) => ({
      id: `scheduled:${task.id}`,
      kind: "Scheduled",
      timestamp: task.updated_at,
      agentId: undefined,
      title: task.title,
      icon: <CalendarClock />,
      category: "Scheduled",
      metadata: {
        Status: !task.enabled
          ? "Paused"
          : task.state === "idle"
            ? "Scheduled"
            : task.state === "running"
              ? "Running"
              : "Failed",
        Agent:
          agents.find(
            (agent) => agent.id === task.agent_id || (!task.agent_id && agent.system_managed),
          )?.name || "—",
        Created: date(task.created_at),
      },
      sortValues: { Created: Date.parse(task.created_at) },
      updatedAt: task.updated_at,
      updated: date(task.updated_at),
      onOpen: () => navigate(`/agents?view=scheduled&task=${encodeURIComponent(task.id)}`),
    })),
  ].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  const rows =
    section === "all"
      ? allRows.map((row) => ({ ...row, category: row.kind }))
      : section === "agents"
        ? agentRows
        : conversationRows;
  const items = rows
    .filter((row) => row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .map((row) => ({
      ...row,
      updatedAt: row.timestamp,
      actions: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton disabled={disabled} label={`More actions for ${row.title}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={disabled} onSelect={row.onOpen}>
              Open
            </DropdownMenuItem>
            {row.agentId && (
              <DropdownMenuItem disabled={disabled} onSelect={() => onSelect(row.agentId!, true)}>
                New chat
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }));
  return (
    <CollectionPage className="flex-1 w-full">
      <CollectionHeading
        title="Agents"
        actions={
          <>
            <CollectionSearch
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
            {section !== "activity" && (
              <Button
                variant="primary"
                className="px-4"
                disabled={disabled}
                onClick={
                  section === "scheduled"
                    ? () => setCreatingSchedule(true)
                    : section === "agents" || section === "all"
                      ? onCreate
                      : onNewChat
                }
              >
                <Plus />
                {section === "scheduled"
                  ? "New task"
                  : section === "agents" || section === "all"
                    ? "New agent"
                    : "New chat"}
              </Button>
            )}
          </>
        }
      />
      <CollectionFilters
        collectionId="agents"
        options={[
          { value: "all", label: "All" },
          { value: "agents", label: "Agents" },
          { value: "conversations", label: "Conversations" },
          { value: "activity", label: "Activity" },
          { value: "scheduled", label: "Scheduled" },
        ]}
        value={section}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === "all") next.delete("view");
          else next.set("view", value);
          next.delete("task");
          next.delete("activity");
          next.delete("agent");
          next.delete("conversation");
          setParams(next, { replace: true });
          setQuery("");
        }}
        actions={<CollectionViewToggle value={view} onChange={setView} />}
      />
      {error && (
        <div role="alert" className="flex items-center gap-3 text-sm">
          {error}
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {section === "all" &&
        (statusState === "unavailable" ||
          (schedules.accountId === user?.id && schedules.error)) && (
          <div role="alert" className="flex items-center gap-3 text-sm">
            Some items couldn’t load.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void schedules.load();
                setStatusRevision((value) => value + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}
      {section === "scheduled" ? (
        <ScheduledCollection
          query={query}
          view={view}
          creating={creatingSchedule}
          onCreatingChange={setCreatingSchedule}
        />
      ) : section === "activity" ? (
        <MistyDashboard
          collection={{ query, view, activityId: params.get("activity") ?? undefined }}
        />
      ) : loading ? (
        <Spinner label="Loading agents" />
      ) : (
        <CollectionItems
          columnSetId={`agents:${section}`}
          fields={
            section === "all"
              ? ["Status", "Agent", "Created"]
              : section === "agents"
                ? ["Role", "Model", "Created"]
                : ["Model", "Messages", "Created"]
          }
          items={items}
          view={view}
          categoryLabel={section === "all" ? "Type" : section === "agents" ? "Status" : "Agent"}
        />
      )}
    </CollectionPage>
  );
}
