import type {
  AgentToolboxAction,
  AgentToolboxActivity,
} from "@/services/spaces/dto/interfaces/agentArchitectureTypes";
import { Checkbox, Label } from "@/shared/ui";

export function PersonalAgentToolboxFieldset({
  actions,
  activity,
  loaded,
  onActionsChange,
}: {
  actions: AgentToolboxAction[];
  activity: AgentToolboxActivity[];
  loaded: boolean;
  onActionsChange: (actions: AgentToolboxAction[]) => void;
}) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-charcoal-border p-3">
      <legend className="px-1 text-sm font-medium">Agent Toolbox</legend>
      <p className="m-0 text-xs text-cream-muted">
        Choose exact actions. Space permissions, connections, and approvals are checked again
        whenever the Agent acts.
      </p>
      {!loaded ? (
        <p className="m-0 text-xs text-cream-muted">Loading available actions…</p>
      ) : (
        <div className="grid gap-2">
          {actions.map((action) => (
            <Label
              key={action.name}
              className="flex items-start gap-2 rounded-md border border-charcoal-border/70 p-2.5 font-normal"
            >
              <Checkbox
                className="mt-0.5"
                checked={action.granted}
                onCheckedChange={(checked) =>
                  onActionsChange(
                    actions.map((candidate) =>
                      candidate.name === action.name
                        ? { ...candidate, granted: checked === true }
                        : candidate,
                    ),
                  )
                }
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {toolboxActionLabel(action.name)}
                  <span className="rounded bg-charcoal-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cream-muted">
                    {action.risk}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-cream-muted">
                  {action.description}
                  {action.approval !== "none"
                    ? ` Approval: ${action.approval === "interactive" ? "always ask" : "explicit request"}.`
                    : ""}
                </span>
              </span>
            </Label>
          ))}
        </div>
      )}
      {activity.length > 0 ? (
        <div className="grid gap-1 border-t border-charcoal-border pt-2">
          <p className="m-0 text-xs font-medium">Recent action activity</p>
          {activity.slice(0, 5).map((item, index) => (
            <p
              className="m-0 flex items-center justify-between gap-2 text-xs text-cream-muted"
              key={`${item.tool_name}-${item.created_at}-${index}`}
            >
              <span className="truncate">{toolboxActionLabel(item.tool_name)}</span>
              <span className={item.state === "failed" ? "text-cream-bright" : ""}>
                {item.state}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

function toolboxActionLabel(name: string): string {
  return name
    .split(".")
    .map((part) => part.split("_").join(" "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");
}
