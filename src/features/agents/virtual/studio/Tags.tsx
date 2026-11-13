import { useFrame } from "@react-three/fiber";
import {
  AppWindow,
  Brain,
  Ellipsis,
  FileText,
  Globe,
  Monitor,
  Plug,
  Plus,
  Search,
  SquareTerminal,
  StickyNote,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { Vector3 } from "three";
import { Pressable, OverflowFadeText } from "@/shared/ui";
import { EngineMark } from "@/features/engine-config/EngineMark";
import type { Actor } from "./behaviour";
import { spreadLabels, type Label } from "./spread";

/**
 * Keeps every label, which is ordinary page content laid over the scene, by its figure: names
 * under the feet and bubbles over the head. Labels that would cover each other are moved apart,
 * the ones that matter most keeping their place (`spreadLabels`).
 */
export function TagProjector(props: {
  anchors: Map<string, Vector3>;
  tags: Map<string, HTMLElement>;
}) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const labels: (Label & { element: HTMLElement; depth: number })[] = [];
    for (const [key, element] of props.tags) {
      // A label can hang from another's point: a speech bubble from its figure's head.
      const anchor = props.anchors.get(element.dataset.anchor ?? key);
      if (!anchor) continue;
      point.copy(anchor).project(camera);
      if (point.z >= 1) {
        element.style.visibility = "hidden";
        continue;
      }
      const label = element.firstElementChild as HTMLElement | null;
      labels.push({
        id: key,
        element,
        depth: point.z,
        x: (point.x * 0.5 + 0.5) * size.width,
        y: (-point.y * 0.5 + 0.5) * size.height,
        w: label?.offsetWidth ?? 0,
        h: label?.offsetHeight ?? 0,
        priority: Number(element.dataset.priority ?? 3),
        up: element.dataset.up === "true",
      });
    }
    const placed = spreadLabels(labels);
    for (const label of labels) {
      const at = placed.get(label.id);
      const { element } = label;
      element.style.transform = `translate3d(${label.x.toFixed(1)}px, ${(label.y + (at?.dy ?? 0)).toFixed(1)}px, 0)`;
      // Nearer labels go over farther ones, and the ones that matter over the rest.
      element.style.zIndex = String(
        (4 - label.priority) * 100000 + Math.round((1 - label.depth) * 99999),
      );
      element.style.visibility = at?.hidden ? "hidden" : "visible";
    }
  });
  return null;
}

/** How much a figure's label matters, which decides who keeps their place when labels crowd. */
export function labelPriority(actor: Actor, selected: boolean): number {
  if (selected) return 0;
  if (actor.state === "needs-you") return 1;
  return actor.state === "working" ? 2 : 3;
}

/** Free desks' markers matter least: they give way to every name. */
export const FREE_DESK_PRIORITY = 4;

/**
 * The second line of a name tag: what the agent is on, or that it needs you. A resting agent has
 * none, so a room of idle agents is just their names. How its last run ended isn't a line: its
 * name takes that state's color, as a chat row's mark does.
 */
export function tagLine(actor: Actor): string {
  if (actor.state === "needs-you") return "Needs you";
  if (actor.guest) return `${actor.owner}'s agent`;
  if (actor.state === "working") return actor.task || actor.doing || "Working";
  return "";
}

const outcomeWords = { done: "Done", failed: "Failed" } as const;

/**
 * The name over a figure's head, as players' names float in a game: its engine's mark and name,
 * and under them what it is on, with a mark for the kind of work, or that it needs its person.
 * A resting agent shows its name alone.
 */
export function ActorTag(props: {
  actor: Actor;
  name: string;
  selected: boolean;
  onPick(id: string): void;
}) {
  const { actor, selected } = props;
  const line = tagLine(actor);
  const Icon = actor.state === "working" ? (doingIcons[actor.doingCode] ?? Ellipsis) : null;
  const outcome = actor.state === "resting" && actor.outcome ? outcomeWords[actor.outcome] : "";
  const spoken = [props.name, outcome, line].filter(Boolean).join(", ");
  return (
    <Pressable
      type="button"
      className="virtual-studio-tag"
      data-state={actor.state}
      data-outcome={actor.outcome || undefined}
      data-selected={selected || undefined}
      aria-label={spoken}
      onClick={() => props.onPick(actor.id)}
    >
      <span className="virtual-studio-tag-name">
        {actor.engine ? <EngineMark engine={actor.engine} size={11} /> : null}
        <OverflowFadeText>{props.name}</OverflowFadeText>
      </span>
      {line ? (
        <span className="virtual-studio-tag-line">
          {Icon ? <Icon size={11} strokeWidth={2.4} aria-hidden="true" /> : null}
          <OverflowFadeText>{line}</OverflowFadeText>
        </span>
      ) : null}
    </Pressable>
  );
}

/** A free desk, marked the way a game marks a plot for sale: picking it hires someone for it. */
export function FreeDeskMarker(props: { onHire(): void }) {
  return (
    <Pressable
      type="button"
      className="virtual-studio-free-desk"
      aria-label="Hire someone for this desk"
      onClick={props.onHire}
    >
      <Plus size={13} strokeWidth={2.6} aria-hidden="true" />
      <span>Hire</span>
    </Pressable>
  );
}

const doingIcons: Record<string, LucideIcon> = {
  browser: Globe,
  web: Search,
  shell: SquareTerminal,
  files: FileText,
  space: StickyNote,
  computer: Monitor,
  app: Plug,
  agents: Users,
  memory: Brain,
  working: AppWindow,
  thinking: Ellipsis,
};

/** What an agent is saying over its head while it answers something asked in the studio. */
export function SpeechBubble(props: { speech: string }) {
  return (
    <span className="virtual-studio-bubble" data-kind="speech">
      {props.speech}
    </span>
  );
}
