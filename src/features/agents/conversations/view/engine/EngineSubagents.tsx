import { useId, useState } from "react";
import { Text, ToolBody, ToolList, ToolRow } from "@misty/ui";
import type { EngineSubagent } from "./engine_turn_store";
import { Fold } from "../../../progress/WorkGroup";

const verbs: Record<EngineSubagent["state"], string> = {
  running: "Working",
  completed: "Done",
  failed: "Didn’t finish",
};

const rowState = (state: EngineSubagent["state"]) =>
  state === "completed" ? "done" : state === "failed" ? "failed" : "running";

function Subagent({ subagent }: { subagent: EngineSubagent }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const steps = subagent.rows.length;
  const opens = steps > 0;
  return (
    <li>
      <ToolRow
        name={verbs[subagent.state]}
        target={subagent.goal || subagent.name}
        meta={steps ? (steps === 1 ? "1 step" : `${steps} steps`) : undefined}
        state={rowState(subagent.state)}
        open={opens ? open : undefined}
        onToggle={opens ? () => setOpen(!open) : undefined}
        controls={opens ? bodyId : undefined}
      />
      {opens ? (
        <Fold id={bodyId} open={open} onReveal={() => setOpen(true)}>
          <ToolBody>
            {subagent.rows.map((step) => (
              <Text key={step.id} size="meta" tone={step.state === "failed" ? "failed" : "muted"}>
                {step.name}
                {step.detail ? (
                  <Text as="span" bare size="meta" tone="default">
                    {` ${step.detail}`}
                  </Text>
                ) : null}
              </Text>
            ))}
          </ToolBody>
        </Fold>
      ) : null}
    </li>
  );
}

export function EngineSubagents({ subagents }: { subagents: EngineSubagent[] }) {
  if (!subagents.length) return null;
  return (
    <div className="my-3">
      <ToolList label="Sub-agents">
        {subagents.map((subagent) => (
          <Subagent key={subagent.id} subagent={subagent} />
        ))}
      </ToolList>
    </div>
  );
}
