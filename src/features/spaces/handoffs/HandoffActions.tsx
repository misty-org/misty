import { useEffect } from "react";
import { agentAccountId, draftRequestForAgent, usePersonalAgentsStore } from "@/features/agents";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@misty/ui";
import { markHandoffHandled } from "./handledHandoffs";

/**
 * A handoff's two answers. "Give to my agent" opens a new chat with one of this person's own
 * agents and puts the words in its composer, unsent, so it becomes their request only when they
 * send it. "Dismiss" just stops it waiting on this device.
 */
export function HandoffActions(props: {
  spaceId: string;
  me: string;
  handoffId: string;
  text: string;
  /** The agent the sender asked for, when it is one of this person's own: offered first. */
  agentId?: string;
  onError: (message: string) => void;
}) {
  const agents = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    const store = usePersonalAgentsStore.getState();
    const account = agentAccountId();
    if (store.accountId !== account || !store.agents.length) void store.load(account);
  }, []);
  const enabled = agents.filter((agent) => agent.enabled);
  // The agent asked for goes first, so a click on the menu's top row hands it on.
  const asked = enabled.find((agent) => agent.id === props.agentId);
  const mine = asked ? [asked, ...enabled.filter((agent) => agent !== asked)] : enabled;
  const done = () => markHandoffHandled(props.me, props.spaceId, props.handoffId);
  const give = (agentId: string) => {
    const problem = draftRequestForAgent(agentId, props.text);
    if (problem) props.onError(problem);
    else done();
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      {mine.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary">
              Give to my agent
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {mine.map((agent) => (
              <MenuItem
                key={agent.id}
                label={agent === asked ? `${agent.name} (asked for)` : agent.name}
                onSelect={() => give(agent.id)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={!mine.length}
          onClick={() => mine[0] && give(mine[0].id)}
        >
          {asked ? `Give to ${asked.name}` : "Give to my agent"}
        </Button>
      )}
      <Button type="button" variant="quiet" onClick={done}>
        Dismiss
      </Button>
    </div>
  );
}
