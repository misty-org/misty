import { MessageSquare, X } from "lucide-react";
import { Button, IconButton } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import type { Actor } from "./office/behaviour";
import type { OfficeAgent } from "./useOfficeAgents";

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Resting" } as const;

/**
 * The card for the figure that was picked: who it is, what it is doing, the last few things it
 * did, and the way into its chat. A teammate's agent can be looked at but not asked, so its card
 * has no buttons: an agent takes requests only from its own person.
 */
export function AgentCard(props: {
  actor: Actor;
  /** The person's own agent behind the figure; a visitor has none. */
  item?: OfficeAgent;
  onOpenChat(agentId: string, conversationId: string): void;
  onClose(): void;
}) {
  const { actor, item } = props;
  const doing = actor.state === "resting" ? "Nothing running" : actor.doing || "Working";
  const open = () => item && props.onOpenChat(item.agent.id, item.conversationId);
  return (
    <section className="virtual-office-card" data-state={actor.state} aria-label={actor.name}>
      <header className="virtual-office-card-head">
        <AgentAvatar agent={item?.agent} />
        <div className="grid min-w-0 gap-1">
          <h3 className="truncate text-sm font-medium text-cream-bright">
            {actor.guest ? `${actor.name} · ${actor.owner}` : actor.name}
          </h3>
          <span className="virtual-office-state" data-state={actor.state}>
            {stateWords[actor.state]}
          </span>
        </div>
        <IconButton label="Close" size="xs" className="ml-auto self-start" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <p className="virtual-office-card-doing">{doing}</p>
      {item?.task && actor.state !== "resting" ? (
        <p className="virtual-office-card-task">{item.task}</p>
      ) : null}
      {item?.steps.length ? (
        <ol className="virtual-office-card-steps" aria-label="Recent steps">
          {item.steps.map((step, index) => (
            <li key={`${index}:${step}`}>{step}</li>
          ))}
        </ol>
      ) : null}
      {item ? (
        <div className="flex gap-2">
          {actor.state === "needs-you" ? (
            <Button variant="primary" size="sm" className="flex-1" onClick={open}>
              Answer
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="flex-1" onClick={open}>
            <MessageSquare aria-hidden="true" />
            Open chat
          </Button>
        </div>
      ) : null}
    </section>
  );
}
