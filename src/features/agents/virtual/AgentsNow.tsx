import type { ReactNode } from "react";
import { Pressable, Skeleton } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { claimedByOthers, fileName, type TeammateAgent, useTeammateAgents } from "./teammates";
import { useStudioAgents } from "./useStudioAgents";
import "./agentsNow.css";

/** What a card says under the name: what the agent is on, or that it is free. */
function Doing({ state, doing }: { state: string; doing: string }) {
  return (
    <span className="agents-now-doing">
      {state !== "resting" && <span className="agents-now-dot" aria-hidden="true" />}
      <span className="truncate">{doing || "Idle"}</span>
    </span>
  );
}

/** What a working agent is changing, or that a teammate's agent claimed the same file. */
function Claim({ files, teammates }: { files: string[]; teammates: TeammateAgent[] }) {
  const clash = claimedByOthers(files, teammates)[0];
  if (clash) {
    return (
      <span className="agents-now-claim" data-clash="true" title={clash.file}>
        <span className="truncate">
          {clash.by.owner}'s {clash.by.name} is on {fileName(clash.file)}
        </span>
      </span>
    );
  }
  if (!files.length) return null;
  return (
    <span className="agents-now-claim" title={files.join("\n")}>
      <span className="truncate">
        {fileName(files[0]!)}
        {files.length > 1 ? ` and ${files.length - 1} more` : ""}
      </span>
    </span>
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
      <div className="agents-now">
        {loading
          ? Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="agents-now-card" aria-hidden="true">
                <Skeleton className="size-9 rounded-full" />
                <div className="grid gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
              </div>
            ))
          : sorted.map(({ agent, state, doing, conversationId, files }) => (
              <Pressable
                key={agent.id}
                type="button"
                className="agents-now-card"
                data-state={state}
                onClick={() => props.onOpenChat(agent.id, conversationId)}
              >
                <AgentAvatar agent={agent} />
                <span className="grid min-w-0 gap-0.5 text-left">
                  <span className="truncate text-sm font-medium text-cream">{agent.name}</span>
                  <Doing state={state} doing={doing} />
                  <Claim files={files} teammates={teammates} />
                </span>
              </Pressable>
            ))}
        {/* Teammates' agents can be looked at, not asked: each takes requests only from its person. */}
        {teammates.map((mate) => (
          <div key={mate.key} className="agents-now-card" data-state={mate.state}>
            <AgentAvatar />
            <span className="grid min-w-0 gap-0.5 text-left">
              <span className="truncate text-sm font-medium text-cream">
                {mate.name} · {mate.owner}
              </span>
              <Doing state={mate.state} doing={mate.doing} />
              <Claim files={mate.files} teammates={[]} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
