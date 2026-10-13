import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Hand, ListPlus, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { interventionLabels } from "@/features/agent-interventions/api";
import { useAgentInterventions } from "@/features/agent-interventions/store";
import { releasePendingWait } from "@/features/agent-interventions/WaitingForYouCard";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import {
  detectShortcutPlatform,
  formatShortcutLabel,
  shortcutMatchesEvent,
} from "@/features/shortcuts";
import { cn, IconButton, MessageComposer, MessageComposerSend } from "@/shared/ui";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { listenForActionQuestions, useActionQuestions } from "./actionQuestions";
import { AgentDockControls } from "./dock/AgentDockControls";
import { useAgentDockSync } from "./dock/agentDock";
import { endHostedSession } from "./hostedSessions";
import { useHostedSessions } from "./hostedSessionsState";
import {
  finishLocalExecution,
  pauseLocalExecution,
  queueLocalFollowup,
  routeLocalFollowup,
  steerLocalExecution,
  useLocalExecution,
  type Execution,
} from "./localExecution";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { toolLabel } from "./progress/progressTimeline";
import { autopilotStopShortcut, watchWorkspaceAutopilot } from "./workspaceAutopilot";

/**
 * The control island (docs/design/agents-at-cursor/BRIEF.md): the one place to
 * see and steer what an agent is doing, at the bottom of the window. It shows
 * the task's status and sub-agents, takes a message that steers the task or
 * queues a new one, and holds Take over, Resume, Stop and Done, and the dock's
 * Detach, Show, Bring back and Dock. With no task
 * here it says which agents work on this computer for another device. During
 * desktop control the native island outside Misty mirrors it and sends its
 * presses back here.
 */
const islandClass = cn(
  "pointer-events-auto fixed inset-x-0 bottom-4 layer-workspace-overlay mx-auto flex flex-col gap-2",
  "w-[min(560px,calc(100dvw-32px))] rounded-2xl border border-charcoal-border bg-charcoal-card",
  "p-2 text-cream shadow-lg",
);

const settled = new Set(["completed", "failed", "canceled", "cancelled"]);

function liveReply(state: ReturnType<typeof useMistyStore.getState>): GlobalAiMessage | undefined {
  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const messages = conversation?.messages ?? [];
  let reply: GlobalAiMessage | undefined;
  for (let index = messages.length - 1; index >= 0 && !reply; index--)
    if (messages[index].role === "assistant") reply = messages[index];
  return reply?.state === "streaming" || reply?.state === "pending" ? reply : undefined;
}

/** What the run is doing now, from the live reply: its activity or latest step. */
function liveStep(state: ReturnType<typeof useMistyStore.getState>) {
  const reply = liveReply(state);
  if (!reply) return "";
  if (reply.activity) return reply.activity;
  const last = reply.progress?.[reply.progress.length - 1];
  if (last?.type === "tool") return toolLabel(last.name, last.state === "running");
  return last?.text ?? "";
}

function statusText(
  execution: Execution,
  name: string,
  step: string,
  waiting: string,
  stopped: boolean,
) {
  if (execution.state === "running")
    return (
      step ||
      (execution.desktopControl
        ? `${name} is working with its own cursor`
        : execution.autopilot
          ? `${name} is controlling Misty`
          : `${name} is working`)
    );
  if (execution.state === "waiting")
    return waiting || `${name} is waiting for you. Press Done when you're finished.`;
  if (execution.state === "paused")
    return stopped
      ? "Stopped. Completed changes have not been undone."
      : "Paused. You have control.";
  return "Task finished. Review the result, then press Done.";
}

export function AgentControlIsland() {
  const execution = useLocalExecution((state) => state.execution);
  const questions = useActionQuestions((state) => state.items.length);
  useEffect(() => listenForActionQuestions(), []);
  const hosted = useHostedSessions((state) => state.sessions);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const step = useMistyStore(liveStep);
  const helpers = useMistyStore(
    (state) =>
      liveReply(state)?.subagents?.filter((child) => !settled.has(child.state)).length ?? 0,
  );
  const invocationId = useMistyStore((state) => state.invocationId);
  const wait = useAgentInterventions((state) =>
    state.items.find((item) => invocationId && item.runId === invocationId),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [message, setMessage] = useState("");
  const name = agents.find((agent) => agent.id === execution?.agentId)?.name ?? "Misty";
  const taskId = execution?.taskId;
  const running = execution?.state === "running";
  const waiting = wait
    ? `${interventionLabels[wait.action]}${wait.targetLabel ? ` · ${wait.targetLabel}` : ""}`
    : "";
  const status = questions
    ? `${name} is waiting for your OK`
    : execution
      ? statusText(execution, name, step, waiting, stopped)
      : "";
  const meta = helpers ? `${helpers} ${helpers === 1 ? "helper" : "helpers"}` : "";

  useEffect(() => {
    setError("");
    setNotice("");
    setStopped(false);
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; message: string }>).detail;
      if (detail.taskId === taskId) setError(detail.message);
    };
    window.addEventListener("misty:autopilot-error", failed);
    return () => window.removeEventListener("misty:autopilot-error", failed);
  }, [taskId]);

  // A task that operates Misty itself holds the window only while it is current.
  useEffect(() => {
    if (!execution?.autopilot || !running || !execution.ready) return;
    const stop = (reason?: string) => {
      if (reason) setError(reason);
      void pauseLocalExecution(execution.taskId).catch((failure) => setError(String(failure)));
    };
    const unwatch = watchWorkspaceAutopilot(
      execution.taskId,
      execution.accountId,
      execution.spaceId,
      stop,
      execution.desktopControl,
    );
    const key = (event: KeyboardEvent) => {
      if (shortcutMatchesEvent(autopilotStopShortcut(), event)) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      unwatch();
      window.removeEventListener("keydown", key, true);
    };
    // Re-watch only when the task, its readiness or its kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskId,
    execution?.accountId,
    execution?.spaceId,
    execution?.ready,
    execution?.desktopControl,
    running,
  ]);

  useEffect(() => {
    if (error) useMistyStore.setState({ error });
  }, [error]);

  const act = (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    void action()
      .catch((reason) => setError(String(reason)))
      .finally(() => setPending(false));
  };
  const resume = () =>
    act(async () => {
      if (!execution) return;
      setStopped(false);
      // A run waiting for the person continues itself once released.
      if (
        execution.state === "waiting" &&
        (await releasePendingWait(execution.accountId, useMistyStore.getState().invocationId))
      )
        return;
      await steerLocalExecution(
        execution.desktopControl
          ? "Continue the task. Inspect the current desktop and verify prior actions before continuing."
          : execution.autopilot
            ? "Continue the task. Capture the whole Misty window first and verify prior actions before continuing."
            : "Continue the current task. Inspect the current state first; do not repeat completed or uncertain writes.",
      );
    });
  const takeOver = () => act(() => pauseLocalExecution(execution?.taskId));
  // Stop ends the task. A task with its own tabs pauses instead, so its result
  // stays open for review until Done closes it.
  const stop = () =>
    act(async () => {
      if (!execution) return;
      if (execution.views.length || execution.childViews?.length) {
        await pauseLocalExecution(execution.taskId);
        setStopped(true);
      } else await finishLocalExecution();
    });
  // A docked window shows this status, and its Stop is this Stop.
  useAgentDockSync(execution, status, execution?.state === "waiting", () => stop());
  const send = (text: string, queue: boolean) =>
    act(async () => {
      const prompt = text.trim();
      if (!prompt) return;
      setMessage("");
      if (queue) {
        await queueLocalFollowup(prompt);
        setNotice("Queued after this task.");
      } else setNotice(await routeLocalFollowup(prompt));
    });

  // The native island during desktop control: mirror the status, take its presses.
  const desktop = Boolean(execution?.desktopControl);
  useEffect(() => {
    if (!desktop || !taskId) return;
    void invoke("agent_control_island", {
      taskId,
      island: {
        status,
        meta,
        waiting: execution?.state === "waiting" || questions ? status : "",
      },
    }).catch(() => {});
  }, [desktop, taskId, status, meta, execution?.state, questions]);
  const handlers = { resume, takeOver, send };
  useEffect(() => {
    if (!desktop || !taskId) return;
    const remove = getCurrentWindow().listen<{ taskId?: string; action?: string; text?: string }>(
      "misty://agent-island",
      ({ payload }) => {
        if (payload.taskId !== taskId) return;
        if (payload.action === "send" || payload.action === "queue")
          handlers.send(payload.text ?? "", payload.action === "queue");
        else if (payload.action === "takeover") handlers.takeOver();
        else if (payload.action === "done") handlers.resume();
      },
    );
    return () => void remove.then((unlisten) => unlisten());
    // The handlers read the current task through the store; re-listen per task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, taskId]);

  if (!execution) {
    if (!hosted.length && !questions) return null;
    return (
      <aside aria-label="Agents working here" className={islandClass}>
        <AgentActionQuestions />
        {hosted.map((session) => (
          <div key={session.taskId} className="flex items-center gap-2 pl-2">
            <p className="min-w-0 flex-1 truncate text-sm" role="status">
              {agents.find((agent) => agent.id === session.agentId)?.name || "An agent"} is working
              here for one of your other devices
            </p>
            <IconButton
              label="Stop"
              size="sm"
              onClick={() => void endHostedSession(session.taskId)}
            >
              <Square aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </aside>
    );
  }
  const finished = execution.state === "finished";
  const takesMessages = !execution.method && execution.state !== "waiting";
  return (
    <aside aria-label="Agent control" className={islandClass}>
      <AgentActionQuestions />
      <div className="flex min-w-0 items-center gap-2 px-2 pt-1">
        <p className="min-w-0 flex-1 truncate text-sm" role="status">
          {status}
        </p>
        {meta && <span className="shrink-0 text-xs text-cream-muted">{meta}</span>}
      </div>
      {(error || notice) && (
        <p className="px-2 text-xs text-cream-muted" role={error ? "alert" : undefined}>
          {error || notice}
        </p>
      )}
      {takesMessages && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(message, false);
          }}
        >
          <MessageComposer
            className="w-full"
            inputProps={{
              id: "agent-island-message",
              "aria-label": `Message ${name}`,
              value: message,
              onChange: (event) => setMessage(event.target.value),
              placeholder: `Tell ${name} what to change, or ask for something new`,
              disabled: pending,
              onKeyDown: (event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              },
            }}
            actions={
              <>
                <IconButton
                  label="New task"
                  size="sm"
                  disabled={pending || !message.trim()}
                  onClick={() => send(message, true)}
                >
                  <ListPlus aria-hidden="true" />
                </IconButton>
                <MessageComposerSend
                  type="submit"
                  label="Send"
                  busy={pending}
                  disabled={!message.trim()}
                />
              </>
            }
          />
        </form>
      )}
      <div className="flex items-center gap-1" role="group" aria-label="Task controls">
        {running ? (
          <IconButton size="md" label="Take over" disabled={pending} onClick={takeOver}>
            <Hand className="size-4" />
          </IconButton>
        ) : (
          !finished && (
            <IconButton
              size="md"
              label={execution.state === "waiting" ? "Done" : "Resume"}
              disabled={pending || Boolean(execution.method && execution.state !== "waiting")}
              onClick={resume}
            >
              {execution.state === "waiting" ? (
                <Check className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </IconButton>
          )
        )}
        <AgentDockControls execution={execution} agentName={name} disabled={pending} act={act} />
        <span className="flex-1" />
        {execution.autopilot && running && !execution.desktopControl && (
          <kbd className="text-xs text-cream-muted">
            {formatShortcutLabel(autopilotStopShortcut(), detectShortcutPlatform())}
          </kbd>
        )}
        {finished || stopped ? (
          <IconButton
            size="md"
            label="Done"
            disabled={pending}
            onClick={() => act(finishLocalExecution)}
          >
            <Check className="size-4" />
          </IconButton>
        ) : (
          <IconButton size="md" label="Stop task" disabled={pending} onClick={stop}>
            <Square className="size-4" />
          </IconButton>
        )}
      </div>
    </aside>
  );
}
