import { Check, CircleAlert } from "lucide-react";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { SkeletonList } from "@/shared/ui";
import { toolSteps } from "../components/ToolActivity";
import { activityStateLabels, formatActivityTime, useAgentActivity } from "./useAgentActivity";
import "./agentTaskPanel.css";

/**
 * The floating panel beside a conversation. It describes this task only; what the
 * agent can reach in general lives on Integrations.
 */
export function AgentTaskPanel({
  accountId,
  agentId,
  conversation,
  working,
  deviceName,
}: {
  accountId: string;
  agentId: string;
  conversation?: GlobalAiConversation;
  working: boolean;
  deviceName?: string;
}) {
  const activity = useAgentActivity(accountId, agentId);
  if (!conversation)
    return (
      <div className="agent-task-panel">
        <p className="agent-task-panel-note">Details appear here once a task starts.</p>
      </div>
    );
  const runs = activity.entries
    .filter((entry) => entry.conversation_id === conversation.id && !entry.parent_run_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const latest = runs[0];
  const status = working
    ? "Working"
    : latest
      ? (activityStateLabels[latest.state] ?? latest.state.replace(/_/g, " "))
      : "Ready";
  const steps = latest ? toolSteps(latest.events).slice(-8) : [];
  return (
    <div className="agent-task-panel" aria-label="This task">
      <section>
        <h3>This task</h3>
        <dl>
          <dt>Status</dt>
          <dd role="status">{status}</dd>
          <dt>Started</dt>
          <dd>{formatActivityTime(conversation.createdAt)}</dd>
          {latest && (
            <>
              <dt>Updated</dt>
              <dd>{formatActivityTime(latest.updated_at)}</dd>
            </>
          )}
          {deviceName && (
            <>
              <dt>Runs on</dt>
              <dd>{deviceName}</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>Steps</h3>
        {steps.length ? (
          <ul>
            {steps.map((step, index) => (
              <li key={`${step.label}:${index}`} title={step.error ?? step.detail}>
                {step.error ? (
                  <CircleAlert size={14} aria-label="Failed" />
                ) : (
                  <Check size={14} aria-hidden="true" />
                )}
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        ) : activity.loading ? (
          <SkeletonList label="Steps" rows={3} leading="icon" lines={1} />
        ) : (
          <p className="agent-task-panel-note">No tool steps yet.</p>
        )}
      </section>
      {runs.length > 1 && (
        <section>
          <h3>Runs</h3>
          <p className="agent-task-panel-note">
            {runs.length} runs in this conversation. Activity has the full history.
          </p>
        </section>
      )}
    </div>
  );
}
