import { useState } from "react";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import type { GlobalAiConversation } from "@/features/global-search/types";
import type { MistyActivityEntry } from "@/features/misty/activity";
import { Button, SkeletonList } from "@/shared/ui";
import { AgentCollaborationSections } from "../collaboration/AgentCollaborationSections";
import { toolSteps } from "../components/ToolActivity";
import { activityStateIcon, activityStateLabels, formatActivityTime } from "./useAgentActivity";
import "./agentTaskPanel.css";

/** The open conversation's top-level runs, newest first. */
export const conversationRuns = (entries: MistyActivityEntry[], conversationId?: string) =>
  entries
    .filter((entry) => entry.conversation_id === conversationId && !entry.parent_run_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

const stateLabel = (state: string) => activityStateLabels[state] ?? state.replace(/_/g, " ");

/**
 * The Task section of Details. It describes this conversation's task only: the latest
 * run's status and steps, work it handed to other agents, and earlier runs (retries,
 * follow-ups) folded underneath. What every agent can reach lives on Integrations.
 */
export function AgentTaskPanel({
  activity,
  conversation,
  working,
  deviceName,
}: {
  activity: { entries: MistyActivityEntry[]; loading: boolean };
  conversation?: GlobalAiConversation;
  working: boolean;
  deviceName?: string;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  if (!conversation)
    return (
      <div className="agent-task-panel">
        <AgentCollaborationSections />
        <p className="agent-task-panel-note">Details appear here once a task starts.</p>
      </div>
    );
  const runs = conversationRuns(activity.entries, conversation.id);
  const [latest, ...earlier] = runs;
  const status = working ? "Working" : latest ? stateLabel(latest.state) : "Ready";
  const steps = latest ? toolSteps(latest.events).slice(-8) : [];
  // Work the latest run handed to other agents, as they report it.
  const handedOff = latest
    ? activity.entries.filter(
        (entry) =>
          entry.parent_run_id &&
          (entry.parent_run_id === latest.id || entry.parent_run_id === latest.run_id),
      )
    : [];
  return (
    <div className="agent-task-panel">
      <AgentCollaborationSections conversationId={conversation.id} />
      <section>
        <h3>Details</h3>
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
      {handedOff.length > 0 && (
        <section>
          <h3>Handed off</h3>
          <ul>
            {handedOff.map((run) => {
              const Icon = activityStateIcon(run.state);
              return (
                <li key={run.id} title={run.result || run.title}>
                  <Icon size={14} aria-hidden="true" />
                  <span>{run.title || "Agent task"}</span>
                  <small>{stateLabel(run.state)}</small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {earlier.length > 0 && (
        <section>
          <Button
            variant="ghost"
            size="xs"
            className="agent-task-panel-toggle"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier((open) => !open)}
          >
            {earlier.length} earlier run{earlier.length === 1 ? "" : "s"}
            <ChevronDown size={12} aria-hidden="true" />
          </Button>
          {showEarlier && (
            <ul>
              {earlier.map((run) => {
                const Icon = activityStateIcon(run.state);
                return (
                  <li key={run.id}>
                    <Icon size={14} aria-hidden="true" />
                    <span>{stateLabel(run.state)}</span>
                    <small>{formatActivityTime(run.updated_at)}</small>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
