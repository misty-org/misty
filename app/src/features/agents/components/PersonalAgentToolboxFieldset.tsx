import type {
  AgentToolboxAction,
  AgentToolboxActivity,
} from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import { Checkbox, Label } from "@/shared/ui";
import type { AgentAccessSurface } from "../model/interfaces/personal";

const accessSurfaces: Array<{ id: AgentAccessSurface; label: string; description: string }> = [
  { id: "browser", label: "Browser", description: "Signed-in browser tabs and controller runs" },
  { id: "files", label: "Files", description: "Files visible to the invoking person" },
  { id: "terminal", label: "Terminal", description: "Shell sessions and commands" },
  { id: "code_editor", label: "Code", description: "Open projects and editor actions" },
  { id: "spaces", label: "Spaces", description: "Space content allowed to the invoking member" },
  { id: "connections", label: "Connections", description: "Connected services and integrations" },
  { id: "agents", label: "Agents", description: "Delegate work to other available agents" },
  { id: "extensions", label: "Extensions", description: "Enabled extension capabilities" },
];

export function PersonalAgentToolboxFieldset({
  actions,
  activity,
  loaded,
  onActionsChange,
  disabledSurfaces,
  onDisabledSurfacesChange,
}: {
  actions: AgentToolboxAction[];
  activity: AgentToolboxActivity[];
  loaded: boolean;
  onActionsChange: (actions: AgentToolboxAction[]) => void;
  disabledSurfaces?: AgentAccessSurface[];
  onDisabledSurfacesChange?: (surfaces: AgentAccessSurface[]) => void;
}) {
  const inheritedAccess = Boolean(disabledSurfaces && onDisabledSurfacesChange);
  return (
    <fieldset className="grid gap-3 rounded-lg border border-charcoal-border p-3">
      <legend className="px-1 text-sm font-medium">Access</legend>
      <p className="m-0 text-xs text-cream-muted">
        This Agent inherits the permissions of the person who invokes it. Turn off broad surfaces
        it should never use. Scheduled runs inherit the owner’s permissions.
      </p>
      {inheritedAccess ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {accessSurfaces.map((surface) => {
            const enabled = !disabledSurfaces?.includes(surface.id);
            return (
              <Label
                key={surface.id}
                className="flex items-start gap-2 rounded-md border border-charcoal-border/70 p-2.5 font-normal"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    onDisabledSurfacesChange?.(
                      checked === true
                        ? (disabledSurfaces ?? []).filter((id) => id !== surface.id)
                        : Array.from(new Set([...(disabledSurfaces ?? []), surface.id])),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{surface.label}</span>
                  <span className="mt-0.5 block text-xs text-cream-muted">{surface.description}</span>
                </span>
              </Label>
            );
          })}
        </div>
      ) : !loaded ? (
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
      {inheritedAccess ? (
        <p className="m-0 rounded-md bg-charcoal-card px-2.5 py-2 text-[11px] leading-4 text-cream-muted">
          Confirmations are the same as for the invoking person. Raw credentials and cookies,
          changing this policy, and bypassing operating-system authentication remain unavailable.
        </p>
      ) : null}
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
