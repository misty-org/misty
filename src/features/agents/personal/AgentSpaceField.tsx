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
} from "@/shared/ui";
import { useAgentAccountId } from "./agentAccount";
import { moveAgentHome } from "./agentHomeSpace";
import { usePersonalAgentsStore } from "./personalAgentsStore";

/**
 * The Space an agent calls home, as its person's Spaces know it: its own, or the person's own
 * Space for one that has none yet. Null while the Spaces load; `gone` once its Space is.
 */
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

/**
 * The agent's home Space in its settings, to move it to another of the person's Spaces. Its next
 * run works and saves there. The change saves itself.
 */
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

/** Where an agent works, as one quiet line: its home Space. Nothing until the Spaces load. */
export function AgentHomeSpaceLine({ agent }: { agent: AgentProfile | undefined }) {
  const home = useAgentHomeSpace(agent);
  if (!home) return null;
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
