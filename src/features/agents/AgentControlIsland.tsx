import { useEffect } from "react";
import { interventionLabels } from "@/features/agent-interventions/api";
import { useAgentInterventions } from "@/features/agent-interventions/store";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { AgentControlComposer } from "./AgentControlComposer";
import { AgentControlHostedSessions } from "./AgentControlHostedSessions";
import { AgentControlTaskControls } from "./AgentControlTaskControls";
import { listenForActionQuestions, useActionQuestions } from "./actionQuestions";
import { useAgentDockSync } from "./dock/agentDock";
import { useHostedSessions } from "./hostedSessionsState";
import { useLocalExecution } from "./localExecution";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { islandClass, liveStep, settled, statusText, liveReply } from "./agentControlStatus";
import { useAgentControlActions } from "./useAgentControlActions";
import { useAgentControlAutopilot } from "./useAgentControlAutopilot";
import { useAgentControlDesktop } from "./useAgentControlDesktop";

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
  const {
    error,
    notice,
    pending,
    stopped,
    message,
    setMessage,
    setError,
    act,
    resume,
    takeOver,
    stop,
    send,
  } = useAgentControlActions(execution);
  const name = agents.find((agent) => agent.id === execution?.agentId)?.name ?? "Misty";
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

  useAgentControlAutopilot(execution, running, setError);
  useEffect(() => {
    if (error) useMistyStore.setState({ error });
  }, [error]);
  // A docked window shows this status, and its Stop is this Stop.
  useAgentDockSync(execution, status, execution?.state === "waiting", () => stop());
  useAgentControlDesktop(execution, status, meta, questions, { resume, takeOver, send });

  if (!execution) {
    if (!hosted.length && !questions) return null;
    return <AgentControlHostedSessions hosted={hosted} agents={agents} />;
  }
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
        <AgentControlComposer
          name={name}
          message={message}
          setMessage={setMessage}
          pending={pending}
          send={send}
        />
      )}
      <AgentControlTaskControls
        execution={execution}
        name={name}
        running={running}
        pending={pending}
        stopped={stopped}
        act={act}
        takeOver={takeOver}
        resume={resume}
        stop={stop}
      />
    </aside>
  );
}
