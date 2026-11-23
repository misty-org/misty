import { useState } from "react";
import { aiSurfaceApi } from "../../runs/invocations/api";
import type { AgentSubagent } from "../../runs/invocations/invocation_types";
import { Button, Text, ToolBody, ToolList, ToolRow } from "@misty/ui";

const running = new Set(["queued", "running", "awaiting_approval", "awaiting_intervention"]);

type RowState = "running" | "done" | "failed" | "waiting";

function status(state: string): { label: string; row: RowState } {
  if (state === "completed") return { label: "Done", row: "done" };
  if (state === "failed") return { label: "Didn’t finish", row: "failed" };
  if (state === "canceled") return { label: "Stopped", row: "done" };
  if (state === "queued") return { label: "Starting", row: "running" };
  if (state.startsWith("awaiting")) return { label: "Waiting", row: "waiting" };
  return { label: "Working", row: "running" };
}

export function AgentSubagents({ subagents }: { subagents: AgentSubagent[] }) {
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  if (!subagents.length) return null;
  const stop = async (id: string) => {
    setStopping((current) => ({ ...current, [id]: true }));
    await aiSurfaceApi.cancelInvocation(id).catch(() => undefined);
  };
  return (
    <div className="my-3">
      <ToolList label="Sub-agents">
        {subagents.map((subagent) => {
          const { label, row } = status(subagent.state);
          const live = running.has(subagent.state);
          const stoppingNow = stopping[subagent.invocationId] && live;
          return (
            <li key={subagent.invocationId}>
              <ToolRow
                name={stoppingNow ? "Stopping" : label}
                target={subagent.goal}
                state={row}
                meta={
                  live && !stoppingNow ? (
                    <Button
                      size="sm"
                      aria-label={`Stop sub-agent: ${subagent.goal}`}
                      onClick={() => void stop(subagent.invocationId)}
                    >
                      Stop
                    </Button>
                  ) : undefined
                }
              />
              {subagent.summary ? (
                <ToolBody>
                  <Text wrap size="meta" tone="muted">
                    {subagent.summary}
                  </Text>
                </ToolBody>
              ) : null}
            </li>
          );
        })}
      </ToolList>
    </div>
  );
}
