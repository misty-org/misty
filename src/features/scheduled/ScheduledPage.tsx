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
  Input,
  Spinner,
} from "@/shared/ui";
import { CalendarClock, Info, List, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { describeNextRun, describeSchedule } from "./scheduleFormat";
import { ScheduledTaskDetails } from "./ScheduledTaskDetails";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { useScheduledTasksStore } from "./useScheduledTasksStore";
import "./scheduledWorkspace.css";

/** Scheduled tasks own a workspace tab and retain the selected conversation. */
export function ScheduledPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const agents = usePersonalAgentsStore((s) => s.agents);
  const { tasks, state, load } = useScheduledTasksStore();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const listWasOpen = useRef(false);
  useEffect(() => {
    if (listOpen) searchRef.current?.focus();
    else if (listWasOpen.current) listButtonRef.current?.focus();
    listWasOpen.current = listOpen;
  }, [listOpen]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState({ dirty: false, busy: false });
  const [pendingChange, setPendingChange] = useState<() => void>();
  const conversations = useMistyStore((s) => s.conversations);
  const loadingChat = useMistyStore((s) => s.conversationsLoading);
  const working = useMistyStore((s) => s.working);
  const task = tasks.find((t) => t.id === params.get("task")) ?? tasks[0];
  const conversation = conversations.find((c) => c.id === task?.conversation_id);
  const agentId = task?.agent_id || conversation?.agentId;
  const agent = agentId
    ? agents.find((a) => a.id === agentId)
    : agents.find((a) => a.system_managed);
  const blocked = working || draftStatus.busy;
  useEffect(() => {
    void load();
  }, [load]);
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
    next.delete("view");
    next.set("task", item.id);
    setParams(next, { replace: true });
    setListOpen(false);
    setDetailsOpen(false);
  };
  const matching = tasks.filter((t) =>
    t.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <main
      className="scheduled-workspace"
      data-list-open={listOpen}
      data-details-open={detailsOpen}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setListOpen(false);
          setDetailsOpen(false);
        }
      }}
    >
      <aside className="scheduled-roster" aria-label="Scheduled tasks">
        <header className="scheduled-roster-heading">
          <h1>Scheduled</h1>
          <IconButton
            className="scheduled-mobile-control"
            label="Close task list"
            onClick={() => setListOpen(false)}
          >
            <X size={16} />
          </IconButton>
        </header>
        <Button
          variant="ghost"
          justify="start"
          className="scheduled-new-task"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          New task
        </Button>
        <label className="scheduled-search">
          <Search size={14} aria-hidden="true" />
          <Input
            ref={searchRef}
            aria-label="Search scheduled tasks"
            placeholder="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="scheduled-task-list misty-transient-scrollbar">
          {state === "loading" && !tasks.length && <Spinner label="Loading scheduled tasks" />}
          {state === "error" && (
            <div role="alert" className="scheduled-list-note">
              Scheduled tasks couldn’t load.
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          )}
          {([true, false] as const).map((enabled) => {
            const group = matching.filter((t) => t.enabled === enabled);
            if (!group.length) return null;
            return (
              <section key={String(enabled)} aria-label={enabled ? "Upcoming" : "Paused"}>
                <h2 className="scheduled-group-title">{enabled ? "Upcoming" : "Paused"}</h2>
                {group.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    justify="start"
                    className="scheduled-task-row"
                    aria-pressed={task?.id === item.id}
                    disabled={blocked}
                    onClick={() => change(() => select(item))}
                  >
                    <span className="truncate">{item.title}</span>
                    <small className="truncate">{describeNextRun(item)}</small>
                  </Button>
                ))}
              </section>
            );
          })}
          {search && !matching.length && (
            <p className="scheduled-list-note">No tasks match “{search}”.</p>
          )}
        </div>
      </aside>
      <div className="scheduled-main">
        <header className="scheduled-chat-heading">
          <IconButton
            className="scheduled-mobile-control"
            ref={listButtonRef}
            label="Show scheduled tasks"
            aria-expanded={listOpen}
            onClick={() => setListOpen(true)}
          >
            <List size={16} />
          </IconButton>
          {task ? (
            <div className="scheduled-chat-identity">
              <AgentAvatar agent={agent} />
              <div>
                <strong>{agent?.name ?? "Agent unavailable"}</strong>
                <span>{task.title}</span>
              </div>
            </div>
          ) : (
            <span>Scheduled conversations</span>
          )}
          {task && (
            <IconButton
              className="scheduled-details-toggle"
              label="Schedule details"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              <Info size={16} />
            </IconButton>
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
                <div className="scheduled-conversation-intro">
                  <CalendarClock size={24} />
                  <h2>{task.title}</h2>
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
            <div className="scheduled-empty">
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
          state !== "loading" && (
            <div className="scheduled-empty">
              <CalendarClock size={28} />
              <h2>Let an agent take it from here</h2>
              <p>
                Schedule a task with one of your agents. Each run and every follow-up live together
                in its conversation.
              </p>
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} />
                Create your first task
              </Button>
            </div>
          )
        )}
      </div>
      {task && (
        <aside
          className="scheduled-inspector misty-transient-scrollbar"
          aria-label="Schedule details"
        >
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
        </aside>
      )}
      {creating && (
        <ScheduledTaskEditor
          open
          onOpenChange={setCreating}
          defaultAgentId={agent?.id}
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
