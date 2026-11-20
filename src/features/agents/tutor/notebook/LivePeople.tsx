import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  cn,
  LivePointer,
  Text,
  Tooltip,
  type AvatarSize,
} from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { AgentAvatar } from "../../personal/AgentAvatar";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { agentLabel, paneOf, workWords, type NotebookAgent } from "../notebookAgents";
import type { NotebookPane, Person } from "../notebookPresence";
import type { Notebook } from "../tutorTypes";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

/** A member's profile picture as an object URL, or null while it loads and when they have none. */
function usePicture(spaceId: string | undefined, userId: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    const gateway = spacesGateway.maybe();
    if (!spaceId || !gateway) return;
    let live = true;
    void gateway.memberPicture(spaceId, userId).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [spaceId, userId]);
  return url;
}

/** One person: their picture, or their initials in their tone. */
export function PersonAvatar({
  spaceId,
  person,
  size = "sm",
  className,
}: {
  spaceId?: string;
  person: Pick<Person, "id" | "name" | "tone">;
  size?: AvatarSize;
  className?: string;
}) {
  const picture = usePicture(spaceId, person.id);
  return (
    <Avatar size={size} tone={person.tone} className={className}>
      {picture ? <AvatarImage src={picture} alt="" /> : null}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

/** An agent at work in the notebook: its own mark, saying whose it is and what it's doing. */
export function AgentFace({ agent }: { agent: NotebookAgent }) {
  const profile = {
    id: agent.agentId,
    name: agent.name,
    engine: agent.engine,
    avatar: agent.emoji ? { emoji: agent.emoji } : {},
  } as unknown as AgentProfile;
  return (
    <Tooltip content={`${agentLabel(agent)} ${workWords(agent)}`}>
      <span className="inline-flex misty-shimmer">
        <AgentAvatar agent={profile} compact />
      </span>
    </Tooltip>
  );
}

/** Where a person is in the notebook, in a few words. */
export function whereIs(person: Person, notebook: Notebook): string {
  const { lab } = person;
  if (lab.asking) return "Asking their AI";
  if (lab.editing) {
    const note = notebook.notes.find((item) => item.id === lab.editing);
    return `Editing ${note?.title || "a note"}`;
  }
  if (lab.item) {
    const source = notebook.sources.find((item) => item.id === lab.item);
    const note = notebook.notes.find((item) => item.id === lab.item);
    if (source || note) return `Reading ${source?.title ?? note?.title ?? ""}`.trim();
  }
  if (lab.section === "sources") return "In Sources";
  if (lab.section === "studio") return "In Create";
  return "In the notebook";
}

/** Everyone else in the notebook, as overlapping faces, each saying where they are. */
export function FacePile({
  spaceId,
  people,
  agents = [],
  notebook,
}: {
  spaceId?: string;
  people: Person[];
  /** The agents at work in it, which are in it like people. */
  agents?: NotebookAgent[];
  notebook: Notebook;
}) {
  if (!people.length && !agents.length) return null;
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  return (
    <div className="mr-1 flex items-center -space-x-1.5" aria-label="People in this notebook">
      {shown.map((person) => (
        <Tooltip key={person.id} content={`${person.name} · ${whereIs(person, notebook)}`}>
          <span className={cn("inline-flex", person.lab.asking && "misty-shimmer")}>
            <PersonAvatar spaceId={spaceId} person={person} />
          </span>
        </Tooltip>
      ))}
      {agents.slice(0, 3).map((agent) => (
        <AgentFace key={agent.key} agent={agent} />
      ))}
      {more > 0 ? (
        <Text bare size="caption" tone="muted" className="pl-2.5">
          +{more}
        </Text>
      ) : null}
    </div>
  );
}

/** The faces of the people in one pane, for its header. */
export function PaneFaces({
  spaceId,
  people,
  agents = [],
  pane,
}: {
  spaceId?: string;
  people: Person[];
  agents?: NotebookAgent[];
  pane: NotebookPane;
}) {
  const here = people.filter((person) => person.lab.section === pane);
  const working = agents.filter((agent) => paneOf(agent.work) === pane);
  if (!here.length && !working.length) return null;
  return (
    <div className="flex items-center -space-x-1">
      {here.slice(0, 3).map((person) => (
        <Tooltip key={person.id} content={person.name}>
          <span className="inline-flex">
            <PersonAvatar spaceId={spaceId} person={person} size="xs" />
          </span>
        </Tooltip>
      ))}
      {working.slice(0, 2).map((agent) => (
        <AgentFace key={agent.key} agent={agent} />
      ))}
    </div>
  );
}

/** The faces of the people who have a source or note open, for its row. */
export function RowFaces({
  spaceId,
  people,
  agents = [],
  itemId,
}: {
  spaceId?: string;
  people: Person[];
  agents?: NotebookAgent[];
  itemId: string;
}) {
  const here = people.filter(
    (person) => person.lab.item === itemId || person.lab.editing === itemId,
  );
  const working = agents.filter((agent) => agent.item === itemId);
  if (!here.length && !working.length) return null;
  return (
    <span className="flex flex-none items-center -space-x-1">
      {here.slice(0, 2).map((person) => (
        <Tooltip
          key={person.id}
          content={person.lab.editing === itemId ? `${person.name} is editing` : person.name}
        >
          <span className="inline-flex">
            <PersonAvatar spaceId={spaceId} person={person} size="xs" />
          </span>
        </Tooltip>
      ))}
      {working.slice(0, 1).map((agent) => (
        <AgentFace key={agent.key} agent={agent} />
      ))}
    </span>
  );
}

interface Placed {
  person: Person;
  left: number;
  top: number;
}

/** Where each person's pointer falls in this window, from the row and spot it's anchored to. */
function place(frame: HTMLElement, people: Person[]): Placed[] {
  const outer = frame.getBoundingClientRect();
  const placed: Placed[] = [];
  for (const person of people) {
    const pointer = person.lab.pointer;
    // The chat is each person's own, so a pointer over it has nothing here to point at.
    if (!pointer || pointer.pane === "chat") continue;
    const pane = frame.querySelector<HTMLElement>(`[data-live-pane="${pointer.pane}"]`);
    if (!pane) continue;
    const anchor = pointer.anchor
      ? pane.querySelector<HTMLElement>(`[data-live-anchor="${CSS.escape(pointer.anchor)}"]`)
      : null;
    // A source or note open in the middle is only pointed at for someone who has it open too.
    if (pointer.pane === "reader" && !anchor) continue;
    const box = (anchor ?? pane).getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    const x = box.left + pointer.x * box.width;
    const y = box.top + pointer.y * box.height;
    // A row scrolled out of view, or a pane folded away: the pointer isn't shown.
    if (y < paneBox.top || y > paneBox.bottom || x < paneBox.left || x > paneBox.right) continue;
    placed.push({ person, left: x - outer.left, top: y - outer.top });
  }
  return placed;
}

/**
 * Everyone else's pointers over the notebook, with their names, moving as they move. They're
 * placed again each frame while shown, so scrolling a pane keeps them on what they point at.
 */
export function LivePointers({
  frame,
  people,
}: {
  frame: RefObject<HTMLElement | null>;
  people: Person[];
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const pointing = people.filter((person) => person.lab.pointer);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element || !pointing.length) return setPlaced([]);
    let raf = 0;
    const tick = () => {
      setPlaced(place(element, pointing));
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, people]);
  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {placed.map(({ person, left, top }) => (
        <LivePointer key={person.id} name={person.name} tone={person.tone} left={left} top={top} />
      ))}
    </div>
  );
}
