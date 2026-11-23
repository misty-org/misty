import { useEffect, useState } from "react";
import {
  preferredDefaultSpace,
  spacesSnapshot,
  useSpaceWindowStore,
  useSpacesDirectory,
} from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  Field,
  MenuItem,
  MenuTrigger,
  notify,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@misty/ui";
import { usePersonalAgentsStore } from "./personal_agents_store";
import { copyAgent } from "./save_agent";

export function useAgentHomeSpace(agent: Pick<AgentProfile, "id" | "space_id"> | undefined) {
  const spaces = useSpacesDirectory((state) => state.spaces);
  const saved = usePersonalAgentsStore(
    (state) => state.agents.find((item) => item.id === agent?.id)?.space_id,
  );
  const ownId = useSpaceWindowStore((state) => state.personalSpaceId);
  useEffect(() => {
    if (!spacesSnapshot().spaces.length) void spacesSnapshot().load();
  }, []);
  if (!agent || !spaces.length) return null;
  const id = saved || agent.space_id || ownId || "";
  const space = spaces.find((item) => item.id === id);
  return {
    id,
    space,
    gone: !space,
    personal: Boolean(space && space.id === preferredDefaultSpace(spaces)?.id),
    spaces,
  };
}

export function AgentSpaceField({ agent }: { agent: AgentProfile }) {
  const home = useAgentHomeSpace(agent);
  return (
    <Field label="Space">
      {home ? (
        <Select value={home.space ? home.id : ""} disabled>
          <SelectTrigger aria-label={`${agent.name}'s Space`} className="w-full">
            <SelectValue placeholder="No Space" />
          </SelectTrigger>
          <SelectContent>
            {home.space ? (
              <SelectItem key={home.space.id} value={home.space.id} label={home.space.name} />
            ) : null}
          </SelectContent>
        </Select>
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
    </Field>
  );
}

export function CopyAgentToSpace({ agent }: { agent: AgentProfile }) {
  const home = useAgentHomeSpace(agent);
  const [busy, setBusy] = useState(false);
  const shared = (home?.spaces ?? []).filter(
    (space) => !space.is_default && space.id !== home?.id,
  );
  if (!home || !shared.length || agent.system_managed) return null;
  const copy = (spaceId: string, name: string) => {
    setBusy(true);
    void copyAgent(agent, spaceId)
      .then(() => notify({ message: `${agent.name} was copied to ${name}` }))
      .catch((reason: unknown) =>
        notify({
          message: reason instanceof Error ? reason.message : String(reason),
          tone: "error",
        }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <DropdownMenu>
      <MenuTrigger label="Copy to a Space" variant="secondary" disabled={busy} />
      <DropdownMenuContent align="start">
        {shared.map((space) => (
          <MenuItem key={space.id} label={space.name} onSelect={() => copy(space.id, space.name)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
