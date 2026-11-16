import { useEffect, useState } from "react";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { useLiveNotebook } from "./notebookLive";
import { setPresence, type NotebookPane } from "./notebookPresence";
import { useTutorStore } from "./tutorStore";
import type { TutorJob } from "./tutorTypes";

/**
 * Agents are collaborators too: while a person's agent works in a notebook (finding sources,
 * writing the overview, summarizing a source, making a quiz), it is in the notebook like a person,
 * for everyone there, its owner included. What goes out is only what the Space already sees of an
 * agent: its name and mark, and fixed codes for the work and the source it's on, built here from
 * the run, never written by a model.
 */

/** The kind of work, as a fixed code. */
export type AgentWork = "finding" | "overview" | "summarizing" | "note" | "making";

/** An agent at work in a notebook, as its owner's computer says. */
export interface AgentAtWork {
  agentId: string;
  name: string;
  /** Its engine's id, for its mark, or its emoji. */
  engine?: string;
  emoji?: string;
  work: AgentWork;
  /** What a "making" run makes: the job's kind, a fixed code. */
  kind?: TutorJob["kind"];
  /** The source it's on. */
  item?: string;
}

/** An agent at work, with whose it is. */
export interface NotebookAgent extends AgentAtWork {
  /** Unique across owners: the same agent id can exist on two people's computers. */
  key: string;
  ownerId: string;
  ownerName: string;
  mine: boolean;
}

const workOf: Record<TutorJob["kind"], AgentWork> = {
  research: "finding",
  brief: "overview",
  summary: "summarizing",
  note: "note",
  guide: "making",
  deck: "making",
  quiz: "making",
  overview: "making",
  mindmap: "making",
  slides: "making",
  infographic: "making",
  video: "making",
};

/** The pane an agent's work shows in: sources, Create, or the middle. */
export function paneOf(work: AgentWork): NotebookPane | undefined {
  if (work === "finding" || work === "summarizing") return "sources";
  if (work === "making") return "studio";
  return undefined;
}

const makes: Partial<Record<TutorJob["kind"], string>> = {
  guide: "a report",
  deck: "flashcards",
  quiz: "a quiz",
  overview: "an audio overview",
  mindmap: "a mind map",
  slides: "slides",
  infographic: "an infographic",
  video: "a video overview",
};

/** What an agent is doing, in a few words after its name: "is finding sources". */
export function workWords(agent: Pick<AgentAtWork, "work" | "kind">): string {
  switch (agent.work) {
    case "finding":
      return "is finding sources";
    case "overview":
      return "is writing the overview";
    case "summarizing":
      return "is summarizing a source";
    case "note":
      return "is writing a note";
    case "making":
      return `is making ${(agent.kind && makes[agent.kind]) ?? "something"}`;
  }
}

/** An agent's name as others read it: "Lab tutor" for your own, "Sam's Nova" for a teammate's. */
export const agentLabel = (agent: Pick<NotebookAgent, "name" | "ownerName" | "mine">) =>
  agent.mine ? agent.name : `${agent.ownerName}'s ${agent.name}`;

/** This person's agents at work in a notebook, from its runs on this computer. */
export function agentsAtWork(
  jobs: readonly TutorJob[],
  notebookId: string,
  profiles: readonly { id: string; name: string; engine?: string; avatar?: { emoji?: unknown } }[],
): AgentAtWork[] {
  const seen = new Set<string>();
  return jobs
    .filter(
      (job) => job.notebookId === notebookId && (job.state === "queued" || job.state === "running"),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((job): AgentAtWork[] => {
      // One entry an agent: what it started first.
      if (seen.has(job.agentId)) return [];
      seen.add(job.agentId);
      const profile = profiles.find((agent) => agent.id === job.agentId);
      const emoji = profile?.avatar?.emoji;
      return [
        {
          agentId: job.agentId,
          name: profile?.name || "Agent",
          engine: profile?.engine,
          emoji: typeof emoji === "string" && emoji ? emoji : undefined,
          work: workOf[job.kind],
          kind: workOf[job.kind] === "making" ? job.kind : undefined,
          item: job.kind === "summary" || job.kind === "note" ? job.sourceId : undefined,
        },
      ];
    });
}

/** Says which of this person's agents are at work in the notebook, as their runs come and go. */
export function usePublishAgents(notebookId: string) {
  const entry = useLiveNotebook(notebookId);
  const jobs = useTutorStore((state) => state.jobs);
  const profiles = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    if (!entry) return;
    setPresence(notebookId, { agents: agentsAtWork(Object.values(jobs), notebookId, profiles) });
  }, [entry, notebookId, jobs, profiles]);
}

/** Every agent at work in the notebook now: this person's and everyone else's. */
export function useNotebookAgents(notebookId: string): NotebookAgent[] {
  const entry = useLiveNotebook(notebookId);
  const jobs = useTutorStore((state) => state.jobs);
  const profiles = usePersonalAgentsStore((state) => state.agents);
  const [others, setOthers] = useState<NotebookAgent[]>([]);
  useEffect(() => {
    if (!entry) return setOthers([]);
    const awareness = entry.live.awareness;
    const read = () => {
      const found = new Map<string, NotebookAgent>();
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as { id?: string; name?: string } | undefined;
        if (clientId === awareness.clientID || !user?.id || user.id === entry.me) return;
        const agents = ((state.lab as { agents?: AgentAtWork[] } | undefined)?.agents ?? [])
          .filter((agent) => agent && typeof agent.agentId === "string")
          .slice(0, 6);
        for (const agent of agents)
          found.set(`${user.id}:${agent.agentId}`, {
            ...agent,
            key: `${user.id}:${agent.agentId}`,
            ownerId: user.id,
            ownerName: user.name || "Someone",
            mine: false,
          });
      });
      setOthers([...found.values()]);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [entry]);
  // This person's own agents come from their runs here, so they show even before the room opens.
  const mine = agentsAtWork(Object.values(jobs), notebookId, profiles).map((agent) => ({
    ...agent,
    key: `me:${agent.agentId}`,
    ownerId: entry?.me ?? "",
    ownerName: "You",
    mine: true,
  }));
  return [...mine, ...others];
}
