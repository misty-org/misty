import { useEffect, useState } from "react";
import { agentMentionsApi, type AgentMention } from "@/api/spaces/agent-mentions";
import { Skeleton } from "@/shared/ui";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";

const states: Record<string, { state: StatusState; verb: string }> = {
  completed: { state: "done", verb: "Done" },
  failed: { state: "failed", verb: "Failed" },
  canceled: { state: "stopped", verb: "Stopped" },
  working: { state: "running", verb: "Working" },
};

/**
 * Mentions: what this agent did when someone @mentioned it in a Space chat and you were the
 * one asking. Everyone in the chat sees the agent's reply; only you see this.
 */
export function AgentMentionsPage({ agentId }: { agentId: string }) {
  const [mentions, setMentions] = useState<AgentMention[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    agentMentionsApi
      .list(controller.signal)
      .then((items) =>
        setMentions(items.filter((item) => item.request.target_agent_id === agentId)),
      )
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, [agentId]);
  return (
    <div className="agent-studio-pages mentions">
      <div className="agent-studio-page-scroll">
        <h1 className="m-0 mb-1 text-lg font-medium text-cream-bright">Mentions</h1>
        <p className="mb-4 mt-0 text-sm text-cream-muted">
          Times you mentioned this agent in a Space chat, and what it did to answer.
        </p>
        {failed ? (
          <p role="alert">Your mentions couldn&apos;t be loaded. Reopen this page to try again.</p>
        ) : mentions === null ? (
          <Skeleton className="h-24 w-full" />
        ) : mentions.length === 0 ? (
          <p>No mentions yet. Type @ and this agent&apos;s name in a Space chat.</p>
        ) : (
          <StatusTable label="Mentions">
            {mentions.map(({ request, state, view }) => {
              const look = states[state] ?? states.working;
              return (
                <StatusRow
                  key={request.id}
                  state={look.state}
                  verb={look.verb}
                  sub={request.space_name}
                  meta={view.reply ?? view.error ?? view.note}
                >
                  {request.message}
                </StatusRow>
              );
            })}
          </StatusTable>
        )}
      </div>
    </div>
  );
}
