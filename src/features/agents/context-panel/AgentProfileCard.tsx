import { X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, IconButton, SideCard, Text } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { useSpacesDirectory } from "@/features/app-windows";
import { AgentAvatar } from "../personal/AgentAvatar";
import { mistyEngine, useEnginesList } from "../engines/engines_api";

const madeOn = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function AgentProfileCard(props: { agent: AgentProfile; onClose(): void }) {
  const { agent } = props;
  const [, setParams] = useSearchParams();
  const { data: engines } = useEnginesList();
  const homeSpace = useSpacesDirectory((state) =>
    state.spaces.find((space) => space.id === agent.space_id),
  );
  const engineId = agent.engine || mistyEngine;
  const engine =
    engineId === mistyEngine
      ? "Misty"
      : (engines?.find((item) => item.id === engineId)?.name ?? engineId);
  const about = agent.description || agent.role;
  const made = new Date(agent.created_at);
  return (
    <SideCard
      label={`${agent.name}'s profile`}
      corner={
        <IconButton label="Close profile" onClick={props.onClose}>
          <X />
        </IconButton>
      }
      className="context-panel"
    >
      <div className="grid gap-4 p-4">
        <AgentAvatar agent={agent} large />
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Text as="h2" size="title" weight="semibold" tone="bright">
              {agent.name}
            </Text>
            <Badge variant="secondary">Agent</Badge>
          </div>
          <Text size="meta" tone="muted">
            {homeSpace ? `${engine} in ${homeSpace.name}` : engine}
          </Text>
        </div>
        {about ? (
          <Text as="p" size="body" lines={3} full>
            {about}
          </Text>
        ) : null}
        {Number.isNaN(made.getTime()) ? null : (
          <div className="grid gap-1">
            <Text size="meta" weight="semibold" tone="bright">
              Made
            </Text>
            <Text size="meta">{madeOn.format(made)}</Text>
          </div>
        )}
        <Button
          onClick={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set("agentSettings", agent.id);
              return next;
            })
          }
        >
          Edit agent
        </Button>
      </div>
    </SideCard>
  );
}
