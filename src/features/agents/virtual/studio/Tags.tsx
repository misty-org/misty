import { useFrame } from "@react-three/fiber";
import { Ellipsis, Plus, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Vector3 } from "three";
import { SceneBubble, SceneNameTag, SceneSign } from "@/shared/ui";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { doingIcons } from "../doingIcons";
import type { Actor } from "./behaviour";
import { MemberTag } from "./MemberTag";
import { stackLabels, type Label } from "./spread";

/**
 * Keeps every label, which is ordinary page content laid over the scene, by its figure: names
 * under the feet and bubbles over the head. A figure's own labels stack (`stackLabels`); different
 * figures' labels may overlap, nearer ones and the ones that matter most drawn on top, and never
 * move or hide to make room. Off (`shown`), none of them shows.
 */
export function TagProjector(props: {
  anchors: Map<string, Vector3>;
  tags: Map<string, HTMLElement>;
  /** Name tags and what figures say; off, they all stay hidden. */
  shown: boolean;
}) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const labels: (Label & { element: HTMLElement; depth: number })[] = [];
    for (const [key, element] of props.tags) {
      if (!props.shown) {
        element.style.visibility = "hidden";
        continue;
      }
      // A label can hang from another's point: a speech bubble from its figure's head.
      const anchorKey = element.dataset.anchor ?? key;
      const anchor = props.anchors.get(anchorKey);
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
        anchor: anchorKey,
      });
    }
    const placed = stackLabels(labels);
    for (const label of labels) {
      const at = placed.get(label.id);
      const { element } = label;
      element.style.transform = `translate3d(${label.x.toFixed(1)}px, ${(label.y + (at?.dy ?? 0)).toFixed(1)}px, 0)`;
      // Nearer labels go over farther ones, and the ones that matter over the rest.
      element.style.zIndex = String(
        (4 - label.priority) * 100000 + Math.round((1 - label.depth) * 99999),
      );
      element.style.visibility = "visible";
    }
  });
  return null;
}

/** How much a figure's label matters, which decides whose is drawn on top when labels overlap. */
export function labelPriority(actor: Actor, selected: boolean): number {
  if (selected) return 0;
  if (actor.state === "needs-you" || actor.clash) return 1;
  return actor.state === "working" ? 2 : 3;
}

/** Free desks' markers matter least: they give way to every name. */
export const FREE_DESK_PRIORITY = 4;

/**
 * The second line of a name tag: what the agent is on, or that it needs you. A resting agent has
 * none, so a room of idle agents is just their names. How its last run ended isn't a line: its
 * name takes that state's color, as a chat row's mark does.
 */
function tagLine(actor: Actor): string {
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
  if (actor.kind === "member") return <MemberTag {...props} />;
  // A teammate's agent changing the same file shows instead of the work, in the waiting color:
  // a warning, never a stop.
  const line = actor.clash || tagLine(actor);
  const Icon = actor.clash
    ? TriangleAlert
    : actor.state === "working"
      ? (doingIcons[actor.doingCode] ?? Ellipsis)
      : null;
  const outcome = actor.state === "resting" && actor.outcome ? outcomeWords[actor.outcome] : "";
  const spoken = [props.name, outcome, line].filter(Boolean).join(", ");
  return (
    <SceneNameTag
      type="button"
      name={props.name}
      mark={actor.engine ? <EngineMark engine={actor.engine} size={11} /> : null}
      line={line || undefined}
      lineIcon={Icon ? <Icon aria-hidden="true" /> : null}
      state={actor.state === "needs-you" || actor.clash ? "waiting" : actor.state}
      outcome={actor.outcome || undefined}
      selected={selected}
      data-state={actor.state}
      data-outcome={actor.outcome || undefined}
      data-selected={selected || undefined}
      aria-label={spoken}
      onClick={() => props.onPick(actor.id)}
    />
  );
}

/** A free desk, marked the way a game marks a plot for sale: picking it hires someone for it. */
export function FreeDeskMarker(props: { onHire(): void }) {
  return (
    <SceneSign
      type="button"
      icon={<Plus aria-hidden="true" />}
      aria-label="Hire someone for this desk"
      onClick={props.onHire}
    >
      Hire
    </SceneSign>
  );
}

/** What an agent is saying over its head while it answers something asked in the studio. */
export function SpeechBubble(props: { speech: string }) {
  return <SceneBubble>{props.speech}</SceneBubble>;
}
