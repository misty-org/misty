import type { ScheduledTask } from "@/api/scheduled/api";
import { useAuth } from "@/features/auth";
import { AgentAvatar, AgentWorkspaceConversation } from "@/features/agents";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  IconButton,
  CollectionSearch,
  Card,
  WorkspaceSidebar,
  WorkspaceSidebarHeading,
  WorkspaceSectionLabel,
  Spinner,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui";
import { CalendarClock, Plus, Search, ArrowLeft, ListFilter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { describeNextRun, describeSchedule } from "./scheduleFormat";
import { ScheduledTaskDetails } from "./ScheduledTaskDetails";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { useScheduledTasksStore } from "./useScheduledTasksStore";
import { ScheduledWelcome, type ScheduledStarter } from "./ScheduledWelcome";

/** Scheduled tasks own a workspace tab and retain the selected conversation. */
export function ScheduledPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const agents = usePersonalAgentsStore((s) => s.agents);
  const { tasks, state, load } = useScheduledTasksStore();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [starter, setStarter] = useState<ScheduledStarter>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const [draftStatus, setDraftStatus] = useState({ dirty: false, busy: false });
  const [pendingChange, setPendingChange] = useState<() => void>();
  const conversations = useMistyStore((s) => s.conversations);
  const loadingChat = useMistyStore((s) => s.conversationsLoading);
  const working = useMistyStore((s) => s.working);
  const task = tasks.find((t) => t.id === params.get("task"));
  const conversation = conversations.find((c) => c.id === task?.conversation_id);
  const agentId = task?.agent_id || conversation?.agentId;
  const agent = agentId
    ? agents.find((a) => a.id === agentId)
    : agents.find((a) => a.system_managed);
  const blocked = working || draftStatus.busy;
  useEffect(() => {
    useScheduledTasksStore.getState().setAccount(user?.id ?? "");
    void load();
    void usePersonalAgentsStore.getState().load(user?.id ?? "");
  }, [load, user?.id]);
  useEffect(() => {
    const store = useMistyStore.getState();
    store.setAccount(user?.id ?? "");
    if (user?.id && !working) void store.loadConversations();
  }, [user?.id, task?.id, task?.conversation_id, task?.updated_at, working]);
  const conversationId = conversation?.id;
  useEffect(() => {
    if (conversationId && !working) useMistyStore.getState().selectConversation(conversationId);
  }, [conversationId, working]);
  const change = (action: () => void) => {
    if (blocked) return;
    if (draftStatus.dirty) setPendingChange(() => action);
    else action();
  };
  const select = (item: ScheduledTask) => {
    const next = new URLSearchParams(params);
    if (embedded) next.set("view", "scheduled");
    else next.delete("view");
    next.set("task", item.id);
    setParams(next, { replace: true });
  };
  const create = (next?: ScheduledStarter) => {
    setStarter(next);
    setCreating(true);
  };
  const matching = tasks.filter(
    (t) =>
      t.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
      (statusFilter === "all" || (statusFilter === "upcoming" ? t.enabled : !t.enabled)),
  );
  const roster = () => (
    <WorkspaceSidebar className="w-full border-r-0" aria-label="Scheduled tasks">
      <WorkspaceSidebarHeading
        title="Scheduled"
        actions={
          <>
            {embedded && (
              <IconButton
                label="All scheduled tasks"
                disabled={blocked}
                onClick={() =>
                  change(() => {
                    const next = new URLSearchParams(params);
                    next.delete("task");
                    next.set("view", "scheduled");
                    setParams(next);
                  })
                }
              >
                <ArrowLeft />
              </IconButton>
            )}
            <IconButton
              label="Search tasks"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Search />
            </IconButton>
          </>
        }
      />
      <Button variant="outline" size="sm" justify="start" onClick={() => create()}>
        <Plus />
        New task
      </Button>
      {(searchOpen || search) && (
        <CollectionSearch
          ref={searchRef}
          autoFocus
          aria-label="Search scheduled tasks"
          placeholder="Search tasks"
          className="w-full"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <WorkspaceSectionLabel
        compact
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Filter tasks" size="sm" variant="outline">
                <ListFilter />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
                <DropdownMenuRadioItem value="all">All tasks</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="upcoming">Upcoming</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="paused">Paused</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {statusFilter === "paused" ? "Paused" : "Upcoming"}
      </WorkspaceSectionLabel>
      <div className="min-h-0 flex-1 overflow-y-auto misty-transient-scrollbar">
        {state === "loading" && !tasks.length && <Spinner label="Loading scheduled tasks" />}
        {state === "error" && (
          <div role="alert" className="p-2 text-sm text-cream-muted">
            Scheduled tasks couldn’t load.
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}
        {([true, false] as const).map((enabled) => {
          const group = matching
            .filter((t) => t.enabled === enabled)
            .sort(
              (a, b) =>
                (a.next_run_at ? Date.parse(a.next_run_at) : Infinity) -
                (b.next_run_at ? Date.parse(b.next_run_at) : Infinity),
            );
          return group.length ? (
            <section key={String(enabled)} aria-label={enabled ? "Upcoming" : "Paused"}>
              {!enabled && statusFilter === "all" && (
                <WorkspaceSectionLabel>Paused</WorkspaceSectionLabel>
              )}
              {group.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  justify="start"
                  className="h-auto min-h-14 w-full flex-col items-stretch gap-1 px-4 py-3 text-left font-normal"
                  aria-pressed={task?.id === item.id}
                  disabled={blocked}
                  onClick={() => change(() => select(item))}
                >
                  <span className="truncate">{item.title}</span>
                  <small className="truncate text-xs text-cream-muted">
                    {describeNextRun(item)}
                  </small>
                </Button>
              ))}
            </section>
          ) : null;
        })}
        {!matching.length && state === "ready" && (
          <p className="p-2 text-sm text-cream-muted">
            {search
              ? "No matching tasks."
              : statusFilter === "paused"
                ? "No paused tasks."
                : "No upcoming tasks."}
          </p>
        )}
      </div>
    </WorkspaceSidebar>
  );
  const details = task && (
    <ScheduledTaskDetails
      key={task.id}
      task={task}
      agentName={agent?.name ?? "Unavailable agent"}
      deletionDisabled={blocked || draftStatus.dirty}
      onDeleted={() => {
        const next = new URLSearchParams(params);
        next.delete("task");
        setParams(next, { replace: true });
      }}
    />
  );
  return (
    <main className="relative flex h-full min-h-0 w-full overflow-hidden bg-charcoal-workspace text-sm text-cream">
      <div className="h-full w-60 shrink-0 border-r border-charcoal-border">{roster()}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={`flex min-h-14 shrink-0 items-center justify-between gap-3 px-4 py-2 ${task ? "" : "hidden"}`}
        >
          {task && (
            <IconButton
              label="Scheduled overview"
              disabled={blocked}
              onClick={() =>
                change(() => {
                  const next = new URLSearchParams(params);
                  next.delete("task");
                  setParams(next);
                })
              }
            >
              <ArrowLeft />
            </IconButton>
          )}
          {task ? (
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
              <AgentAvatar agent={agent} />
              <div className="grid min-w-0">
                <strong className="font-medium">{agent?.name ?? "Agent unavailable"}</strong>
                <span className="truncate text-xs text-cream-muted">{task.title}</span>
              </div>
            </div>
          ) : (
            <span />
          )}
        </header>
        {task ? (
          conversation && agent ? (
            <AgentWorkspaceConversation
              key={`${user?.id}:${task.id}:${conversation.id}`}
              agent={agent}
              conversationId={conversation.id}
              accountId={user?.id ?? ""}
              spaceId=""
              onCreate={() => change(() => navigate("/agents"))}
              onDraftStateChange={setDraftStatus}
              emptyContent={
                <div className="mx-auto my-10 grid max-w-3xl gap-4 break-words p-6 leading-relaxed">
                  <CalendarClock size={24} />
                  <h2 className="text-xl font-medium">{task.title}</h2>
                  <p>{task.prompt}</p>
                  <small>
                    {describeSchedule(task)} · {describeNextRun(task)}
                  </small>
                  <p className="text-cream-muted">
                    {agent.name} will post each run here. You can chat with {agent.name} below.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
              {loadingChat ? (
                <Spinner label="Loading task conversation" />
              ) : (
                <>
                  <h2>{agent ? "Conversation unavailable" : "Agent unavailable"}</h2>
                  <p>
                    {agent
                      ? "If its conversation was deleted or expired, the next run will start a new one with the same agent."
                      : "This task’s agent may have been removed. Create a new task with an available agent."}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => void useMistyStore.getState().loadConversations()}
                  >
                    Retry conversation
                  </Button>
                </>
              )}
            </div>
          )
        ) : (
          state !== "loading" && <ScheduledWelcome onCreate={create} />
        )}
      </div>
      {task && (
        <>
          <aside className="w-72 shrink-0 overflow-y-auto p-4" aria-label="Schedule details">
            <Card className="p-5">{details}</Card>
          </aside>
        </>
      )}
      {creating && (
        <ScheduledTaskEditor
          open
          onOpenChange={setCreating}
          defaultAgentId={agent?.id}
          starter={starter}
          onSaved={(created) => change(() => select(created))}
        />
      )}
      <AlertDialog
        open={Boolean(pendingChange)}
        onOpenChange={(open) => !open && setPendingChange(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Discard unsent message?</AlertDialogTitle>
          <AlertDialogDescription>Your message has not been sent.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep writing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingChange?.();
                setPendingChange(undefined);
                setDraftStatus({ dirty: false, busy: false });
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
