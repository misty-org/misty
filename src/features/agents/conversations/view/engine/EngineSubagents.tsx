import type { EngineSubagent } from "./engineTurnStore";
import { StatusRow, StatusTable, type StatusState } from "../../../progress/StatusTable";
import { WorkGroup } from "../../../progress/WorkGroup";

const rowState = (state: EngineSubagent["state"]): { verb: string; row: StatusState } =>
  state === "completed"
    ? { verb: "Done", row: "done" }
    : state === "failed"
      ? { verb: "Didn’t finish", row: "failed" }
      : { verb: "Working", row: "running" };

/**
 * The sub-agents an outside engine started (Claude Code's Task, Codex's sub-agent threads), each
 * with the steps it took nested under it, like Misty's own sub-agents.
 */
export function EngineSubagents({ subagents }: { subagents: EngineSubagent[] }) {
  if (!subagents.length) return null;
  const live = subagents.filter((subagent) => subagent.state === "running").length;
  const total = subagents.length;
  const noun = total === 1 ? "sub-agent" : "sub-agents";
  return (
    <WorkGroup
      summary={live ? `Running ${live} of ${total} ${noun}` : `Ran ${total} ${noun}`}
      running={live > 0}
    >
      <StatusTable label="Sub-agents">
        {subagents.map((subagent) => {
          const { verb, row } = rowState(subagent.state);
          return [
            <StatusRow key={subagent.id} state={row} verb={verb}>
              {subagent.goal || subagent.name}
            </StatusRow>,
            ...subagent.rows.map((step) => {
              const child = rowState(step.state);
              return (
                <StatusRow
                  key={`${subagent.id}:${step.id}`}
                  state={child.row}
                  verb={child.verb}
                  sub={step.detail}
                  depth={1}
                >
                  {step.name}
                </StatusRow>
              );
            }),
          ];
        })}
      </StatusTable>
    </WorkGroup>
  );
}
