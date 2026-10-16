import { useState } from "react";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { AgentSubagent } from "@/features/ai-surface/types";
import { Button } from "@/shared/ui";
import { StatusRow, StatusTable, type StatusState } from "../progress/StatusTable";
import { WorkGroup } from "../progress/WorkGroup";

const running = new Set([
  "queued",
  "running",
  "awaiting_approval",
  "awaiting_device",
  "awaiting_intervention",
  "awaiting_timer",
]);

/** Status as an icon, a word and, for waiting or failed, color; never color alone. */
function status(state: string): { label: string; row: StatusState } {
  if (state === "completed") return { label: "Done", row: "done" };
  if (state === "failed") return { label: "Didn’t finish", row: "failed" };
  if (state === "canceled") return { label: "Stopped", row: "stopped" };
  if (state === "queued") return { label: "Starting", row: "next" };
  if (state.startsWith("awaiting")) return { label: "Waiting", row: "waiting" };
  return { label: "Working", row: "running" };
}

/** The sub-agents a run started, as one group line over a table, each with its own Stop. */
export function AgentSubagents({ subagents }: { subagents: AgentSubagent[] }) {
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  if (!subagents.length) return null;
  const stop = async (id: string) => {
    setStopping((current) => ({ ...current, [id]: true }));
    await aiSurfaceApi.cancelInvocation(id).catch(() => undefined);
  };
  const live = subagents.filter((subagent) => running.has(subagent.state)).length;
  const total = subagents.length;
  const noun = total === 1 ? "helper" : "helpers";
  return (
    <WorkGroup
      summary={live ? `Running ${live} of ${total} ${noun}` : `Ran ${total} ${noun}`}
      running={live > 0}
    >
      <StatusTable label="Sub-agents">
        {subagents.map((subagent) => {
          const { label, row } = status(subagent.state);
          const stoppingNow = stopping[subagent.invocationId] && running.has(subagent.state);
          return (
            <StatusRow
              key={subagent.invocationId}
              state={row}
              verb={stoppingNow ? "Stopping" : label}
              sub={subagent.summary || undefined}
              actions={
                running.has(subagent.state) && !stoppingNow ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Stop sub-agent: ${subagent.goal}`}
                    onClick={() => void stop(subagent.invocationId)}
                  >
                    Stop
                  </Button>
                ) : undefined
              }
            >
              {subagent.goal}
            </StatusRow>
          );
        })}
      </StatusTable>
    </WorkGroup>
  );
}
