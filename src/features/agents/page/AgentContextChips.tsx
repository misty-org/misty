import { CircleAlert, Folder, Laptop, Plug } from "lucide-react";
import { Button, Skeleton } from "@/shared/ui";
import { AppLogo } from "../apps/ConnectedAppsCatalog";
import type { AgentAccessState } from "../components/AgentAccess";
import "./agentLanding.css";

/**
 * A one-line summary of what the agent can reach. Each chip opens Integrations,
 * where the full list lives.
 */
export function AgentContextChips({
  access,
  onOpen,
}: {
  access: AgentAccessState;
  onOpen(): void;
}) {
  const device = access.device?.device;
  const folders = access.device?.scopes.filter((scope) => scope.kind === "local_folder") ?? [];
  const active = access.connections.filter((c) => c.status === "active");
  const attention = access.connections.filter((c) => c.status === "needs_attention").length;
  if (access.loading)
    return (
      <div className="agent-context-chips" aria-label="What this agent can reach" aria-busy="true">
        {["w-[118px]", "w-[124px]", "w-[136px]"].map((width) => (
          <Skeleton key={width} className={`agent-context-chip-skeleton ${width}`} />
        ))}
      </div>
    );
  return (
    <div className="agent-context-chips" aria-label="What this agent can reach">
      {device && (
        <Button variant="outline" size="sm" onClick={onOpen}>
          <Laptop size={13} aria-hidden="true" />
          <strong>{device.displayName}</strong>
          {device.status === "online"
            ? "Online"
            : device.status === "revoked"
              ? "Revoked"
              : "Offline"}
        </Button>
      )}
      {folders.length > 0 && (
        <Button variant="outline" size="sm" onClick={onOpen}>
          <Folder size={13} aria-hidden="true" />
          <strong>
            {folders.length === 1 ? folders[0].displayName : `${folders.length} folders`}
          </strong>
          read only
        </Button>
      )}
      {active.slice(0, 3).map((connection) => (
        <Button key={connection.id} variant="outline" size="sm" onClick={onOpen}>
          <AppLogo app={connection.app} size={14} />
          <strong>{connection.name}</strong>
        </Button>
      ))}
      {active.length > 3 && (
        <Button variant="outline" size="sm" onClick={onOpen}>
          +{active.length - 3} apps
        </Button>
      )}
      {attention > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="agent-context-chip-attention"
          onClick={onOpen}
        >
          <CircleAlert size={13} aria-hidden="true" />
          {attention === 1 ? "1 app needs attention" : `${attention} apps need attention`}
        </Button>
      )}
      {!access.connections.length && !access.connectionsError && (
        <Button variant="outline" size="sm" onClick={onOpen}>
          <Plug size={13} aria-hidden="true" />
          Connect apps
        </Button>
      )}
    </div>
  );
}
