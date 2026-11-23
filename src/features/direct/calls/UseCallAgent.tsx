import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Room } from "livekit-client";
import {
  appIcons,
  Button,
  ComposerStatusRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuCheckItem,
} from "@misty/ui";
import { callAgents } from "@/features/agents";
import { CallAgents, type CallAgentView } from "./call_agents";
import type { ActiveCall } from "./call_store";

export interface CallAgentPart {
  rows: ReactNode;
  trigger: ReactNode;
  agents: CallAgentView[];
  remove(id: string): void;
}

const none: CallAgentView[] = [];
const noSubscribe = () => () => undefined;

export function useCallAgent({
  room,
  call,
  others,
  nameOf,
}: {
  room: Room | null;
  call: ActiveCall;
  others: number;
  nameOf(identity: string): string;
}): CallAgentPart {
  const [session, setSession] = useState<CallAgents | null>(null);
  const key = call.key;

  useEffect(() => {
    if (!room) return;
    const created = new CallAgents(room, key);
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [room, key]);

  useEffect(() => {
    if (session) session.others = others;
  }, [session, others]);
  useEffect(() => {
    if (session) session.nameOf = nameOf;
  });

  const agents = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.agents ?? (() => none),
  );

  const profiles = callAgents();
  const AgentsIcon = appIcons.agents;
  const busy = agents.filter(
    (agent) => agent.mine && (agent.state === "thinking" || agent.state === "working"),
  );
  const rows = busy.length ? (
    <>
      {busy.map((agent) => (
        <ComposerStatusRow
          key={agent.key}
          icon={AgentsIcon}
          label={agent.state === "thinking" ? "Thinking" : "Working"}
          actions={
            <Button
              variant="quiet"
              onClick={() => agent.profile && session?.stopTurn(agent.profile.id)}
            >
              Stop
            </Button>
          }
        >
          {agent.name}
        </ComposerStatusRow>
      ))}
    </>
  ) : null;
  const trigger = profiles.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Agents" disabled={call.state !== "live" || !session}>
          <AgentsIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Your agents">
        {profiles.map((profile) => (
          <MenuCheckItem
            key={profile.id}
            label={profile.name}
            checked={agents.some((agent) => agent.mine && agent.profile?.id === profile.id)}
            onCheckedChange={() => session?.toggle(profile)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
  return { rows, trigger, agents, remove: (id) => session?.remove(id) };
}
