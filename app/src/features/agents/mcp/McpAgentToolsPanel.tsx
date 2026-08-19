import { useAuth } from "@/features/auth";
import { Badge, Button, Switch } from "@/shared/ui";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { executionOutcome } from "./normalization";
import { mcpToolKey } from "./types";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";

export function McpAgentToolsPanel(props: {
  agentId: string;
  onManageConnections?: () => void;
  compact?: boolean;
}) {
  const { user } = useAuth();
  const store = useMcpConnectionsStore();
  const { load, loadAgentTools } = store;

  useEffect(() => {
    if (!user?.id || !props.agentId) return;
    void load(user.id).then(() => loadAgentTools(props.agentId));
  }, [load, loadAgentTools, props.agentId, user?.id]);

  const enabled = useMemo(
    () => new Set(store.enabledByAgent[props.agentId] ?? []),
    [props.agentId, store.enabledByAgent],
  );
  const executions = store.executionsByAgent[props.agentId] ?? [];

  return (
    <section
      className={
        props.compact
          ? "grid gap-3"
          : "rounded-xl border border-charcoal-border bg-charcoal-card p-4"
      }
      aria-label="Agent connected tools"
    >
      <header className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cream-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-medium text-cream-bright">Connected tools</h3>
          <p className="mt-1 text-xs text-cream-muted">
            New tools start off. Turn on only what this Agent should be allowed to request.
          </p>
        </div>
        {props.onManageConnections ? (
          <Button size="sm" variant="outline" onClick={props.onManageConnections}>
            Manage
          </Button>
        ) : null}
      </header>

      {!store.connections.length ? (
        <div className="rounded-lg border border-dashed border-charcoal-border p-4 text-center">
          <p className="m-0 text-sm text-cream-muted">No remote tool servers are connected.</p>
          {props.onManageConnections ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={props.onManageConnections}
            >
              Add a connection
            </Button>
          ) : null}
        </div>
      ) : !store.tools.length ? (
        <p className="m-0 rounded-lg border border-charcoal-border p-3 text-xs text-cream-muted">
          Check a connection and find its tools before enabling anything for this Agent.
        </p>
      ) : (
        <div className="grid gap-2">
          {store.tools.map((tool) => {
            const connection = store.connections.find((item) => item.id === tool.connection_id);
            const key = mcpToolKey(tool.connection_id, tool.remote_name);
            const checked = enabled.has(key);
            const busy = store.busy === `tool:${props.agentId}:${key}`;
            return (
              <div
                key={key}
                className="flex items-start gap-3 rounded-lg border border-charcoal-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-cream">
                      {toolTitle(tool.remote_name)}
                    </span>
                    <Badge variant="outline">{riskLabel(tool.default_risk)}</Badge>
                    <Badge variant="outline">Approval required</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-cream-muted">
                    {tool.description || "This remote tool did not provide a description."}
                  </p>
                  <p className="mt-1 text-[11px] text-cream-muted">
                    {connection?.name ?? "Remote connection"} · Runs on the provider through Misty
                  </p>
                  {tool.disabled_reason ? (
                    <p className="mt-1 text-[11px] text-[#d68b80]">{tool.disabled_reason}</p>
                  ) : null}
                </div>
                <Switch
                  aria-label={`Allow ${toolTitle(tool.remote_name)}`}
                  checked={checked}
                  disabled={
                    busy ||
                    Boolean(tool.disabled_reason) ||
                    store.failedToolConnectionIds.length > 0
                  }
                  onCheckedChange={(next) =>
                    void store.setToolEnabled(
                      props.agentId,
                      tool.connection_id,
                      tool.remote_name,
                      next,
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {executions.length ? (
        <div className="border-t border-charcoal-border pt-3">
          <h4 className="m-0 text-xs font-medium text-cream">Recent outcomes</h4>
          <div className="mt-2 grid gap-1.5">
            {executions.slice(0, 5).map((execution) => (
              <div key={execution.id} className="flex items-center gap-2 text-xs text-cream-muted">
                <OutcomeIcon approved={execution.approved} success={execution.success} />
                <span className="min-w-0 flex-1 truncate">{toolTitle(execution.remote_name)}</span>
                <span>{executionOutcome(execution)}</span>
                <span>{new Date(execution.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {store.error ? (
        <p className="m-0 text-xs text-[#d68b80]" role="alert">
          {store.error}
        </p>
      ) : null}
    </section>
  );
}

function OutcomeIcon(props: { approved: boolean; success: boolean }) {
  if (!props.approved) return <AlertTriangle className="size-3.5 text-amber-400" aria-hidden />;
  return props.success ? (
    <CheckCircle2 className="size-3.5 text-status-green" aria-hidden />
  ) : (
    <XCircle className="size-3.5 text-[#d68b80]" aria-hidden />
  );
}

function toolTitle(remoteName: string): string {
  return remoteName
    .split(/[._/-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function riskLabel(risk: string): string {
  if (risk === "read") return "Reads data";
  if (risk === "dangerous") return "High impact";
  return "Can make changes";
}
