import type { ReactNode } from "react";
import { cn, OverflowFadeText, Pressable, Skeleton, Surface, Text, Tooltip } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { claimedByOthers, fileName, type TeammateAgent, useTeammateAgents } from "./teammates";
import { useStudioAgents } from "./useStudioAgents";

/**
 * What a card says under the name: what the agent is on, or that it is free. Color says the state
 * and nothing else: blue while it works, amber when it waits for its person.
 */
function Doing({ state, doing }: { state: string; doing: string }) {
  return (
    <Text
      bare
      size="caption"
      tone={state === "working" ? "working" : state === "needs-you" ? "waiting" : "muted"}
      weight={state === "needs-you" ? "medium" : undefined}
      className="flex min-w-0 items-center gap-1.5"
    >
      {state !== "resting" && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-current",
            state === "working" &&
              "animate-[misty-breathe_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
          )}
        />
      )}
      <OverflowFadeText>{doing || "Idle"}</OverflowFadeText>
    </Text>
  );
}

const claimClass = "flex min-w-0 text-micro opacity-85";

/**
 * One card's frame: the avatar at 36px, then the name and what it is doing. The avatar's own
 * stylesheet sizes it unlayered, so the card's size for it is marked important.
 */
const cardClass = cn(
  "flex min-w-0 items-center gap-3 px-3.5 py-3 transition-colors duration-120",
  "[&>.agent-avatar]:size-9!",
);

/**
 * What a working agent is changing, or that a teammate's agent claimed the same file: amber then,
 * which is a warning and never a stop.
 */
function Claim({ files, teammates }: { files: string[]; teammates: TeammateAgent[] }) {
  const clash = claimedByOthers(files, teammates)[0];
  if (clash) {
    return (
      <Tooltip content={clash.file}>
        <Text bare tone="waiting" className={claimClass} data-clash="true">
          <OverflowFadeText>
            {clash.by.owner}'s {clash.by.name} is on {fileName(clash.file)}
          </OverflowFadeText>
        </Text>
      </Tooltip>
    );
  }
  if (!files.length) return null;
  return (
    <Tooltip content={files.join(", ")}>
      <Text bare tone="muted" className={claimClass}>
        <OverflowFadeText>
          {fileName(files[0]!)}
          {files.length > 1 ? ` and ${files.length - 1} more` : ""}
        </OverflowFadeText>
      </Text>
    </Tooltip>
  );
}

/**
 * The person's agents and what each is doing now, as a row of cards: one that needs its person
 * comes first and says so, a working one names what it is on, and a resting one only shows it is
 * there. Picking a card opens that agent's chat.
 */
export function AgentsNow(props: {
  /** A heading the page puts above the cards; it goes away with them when there are no agents. */
  heading?: ReactNode;
  className?: string;
  onOpenChat(agentId: string, conversationId: string): void;
}) {
  const { agents, loading } = useStudioAgents();
  const teammates = useTeammateAgents((state) => state.agents);
  if (!loading && !agents.length && !teammates.length) return null;
  const order = { "needs-you": 0, working: 1, resting: 2 };
  const sorted = [...agents].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <section className={props.className} aria-label="Agents">
      {props.heading}
      {/* `agents-now` is the hook the Space home's stylesheet lays the cards out by. */}
      <div className="agents-now grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] gap-3">
        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              // The card's avatar is drawn at 36px here, then the name and what it is doing.
              <Surface
                key={index}
                tone="card"
                edge="hairline"
                radius="xl"
                className={cardClass}
                aria-hidden="true"
              >
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-24" />
                  </div>
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </Surface>
            ))
          : sorted.map(({ agent, state, doing, conversationId, files }) => (
              <Surface
                as={Pressable}
                key={agent.id}
                tone="card"
                edge="hairline"
                radius="xl"
                wash="card"
                state={state === "needs-you" ? "waiting" : undefined}
                className={cn(cardClass, state === "resting" && "[&>.agent-avatar]:opacity-80")}
                data-state={state}
                onClick={() => props.onOpenChat(agent.id, conversationId)}
              >
                <AgentAvatar agent={agent} />
                <span className="grid min-w-0 gap-0.5 text-left">
                  <Text tone="default" className="text-sm font-medium">
                    {agent.name}
                  </Text>
                  <Doing state={state} doing={doing} />
                  <Claim files={files} teammates={teammates} />
                </span>
              </Surface>
            ))}
        {/* Teammates' agents can be looked at, not asked: each takes requests only from its person. */}
        {teammates.map((mate) => (
          <Surface
            key={mate.key}
            tone="card"
            edge="hairline"
            radius="xl"
            state={mate.state === "needs-you" ? "waiting" : undefined}
            className={cn(cardClass, mate.state === "resting" && "[&>.agent-avatar]:opacity-80")}
            data-state={mate.state}
          >
            <AgentAvatar />
            <span className="grid min-w-0 gap-0.5 text-left">
              <Text tone="default" className="text-sm font-medium">
                {mate.name} · {mate.owner}
              </Text>
              <Doing state={mate.state} doing={mate.doing} />
              <Claim files={mate.files} teammates={[]} />
            </span>
          </Surface>
        ))}
      </div>
    </section>
  );
}
