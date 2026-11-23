import { useEffect } from "react";
import { OverflowFadeText, Surface, Text } from "@misty/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { interventionLabels } from "../interventions/api";
import { useAgentInterventions } from "../interventions/store";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { AgentControlComposer } from "./AgentControlComposer";
import { AgentControlQuestions } from "./AgentControlQuestions";
import { AgentControlTaskControls } from "./AgentControlTaskControls";
import { listenForActionQuestions, useIslandQuestions } from "./action_questions";
import { useLocalExecution } from "../runs/local-execution/local_execution_state";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { islandClass, liveStep, settled, statusText, liveReply } from "./agent_control_status";
import { useAgentControlActions } from "./use_agent_control_actions";
import { useAgentControlAutopilot } from "./use_agent_control_autopilot";
import { useAgentControlDesktop } from "./use_agent_control_desktop";

export function AgentControlIsland() {
  const execution = useLocalExecution((state) => state.execution);
  const questions = useIslandQuestions().length;
  useEffect(() => listenForActionQuestions(), []);
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
    ? `${interventionLabels[wait.action]}${wait.targetLabel ? ` in ${wait.targetLabel}` : ""}`
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
  useAgentControlDesktop(execution, status, meta, questions, { resume, takeOver, send });

  if (!execution) {
    if (!questions) return null;
    return <AgentControlQuestions />;
  }
  const takesMessages = execution.state !== "waiting";
  return (
    <Surface
      as="aside"
      tone="card"
      edge="hairline"
      aria-label="Agent control"
      className={islandClass}
    >
      <AgentActionQuestions />
      <div className="flex min-w-0 items-center gap-2 px-2 pt-1">
        <OverflowFadeText
          as="p"
          className={`min-w-0 flex-1 text-control ${running && !questions ? "misty-shimmer" : ""}`}
          role="status"
        >
          {status}
        </OverflowFadeText>
        {meta && (
          <Text size="meta" bare tone="muted" className="shrink-0">
            {meta}
          </Text>
        )}
      </div>
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      {!error && notice && (
        <Text size="meta" bare as="p" tone="muted" className="px-2">
          {notice}
        </Text>
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
        running={running}
        pending={pending}
        stopped={stopped}
        act={act}
        takeOver={takeOver}
        resume={resume}
        stop={stop}
      />
    </Surface>
  );
}
