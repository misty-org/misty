import { House, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import {
  preferredDefaultSpace,
  spacesSnapshot,
  useSpaceWindowStore,
  useSpacesDirectory,
} from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import {
  Field,
  PathLine,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useNotice,
} from "@misty/ui";
import { useAgentAccountId } from "./agent_account";
import { moveAgentHome } from "./agent_home_space";
import { usePersonalAgentsStore } from "./personal_agents_store";

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
  const account = useAgentAccountId();
  const home = useAgentHomeSpace(agent);
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const move = (spaceId: string) => {
    if (!home || spaceId === home.id) return;
    void moveAgentHome(account, agent.id, spaceId)
      .then((moved) =>
        usePersonalAgentsStore.setState((state) => ({
          agents: state.agents.map((item) =>
            item.id === moved.id ? { ...item, space_id: moved.space_id } : item,
          ),
        })),
      )
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <Field label="Space">
      {home ? (
        <Select value={home.space ? home.id : ""} onValueChange={move}>
          <SelectTrigger aria-label={`${agent.name}'s Space`} className="w-full">
            <SelectValue placeholder="Pick a Space" />
          </SelectTrigger>
          <SelectContent>
            {home.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id} label={space.name} />
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
    </Field>
  );
}

export function AgentHomeSpaceLine({ agent }: { agent: AgentProfile | undefined }) {
  const home = useAgentHomeSpace(agent);
  const here = useSpaceWindowStore((state) => state.identity);
  if (!home) return null;
  if (here.personal ? home.personal : home.space && home.id === here.spaceId) return null;
  return (
    <PathLine
      label="Where this agent works"
      segments={[
        {
          id: "space",
          icon: home.personal ? House : Layers,
          label: home.space?.name ?? "No Space",
        },
      ]}
    />
  );
}
