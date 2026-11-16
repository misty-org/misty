import { ChevronDown, UserPlus } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  cn,
  Pressable,
  SceneBadge,
  Separator,
  Skeleton,
  StateMark,
  Surface,
  Text,
  type ArtColor,
  type StateMarkKind,
  rowShape,
} from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { initialOf, placeWords, type StudioRequest, type TeamMember } from "./teamMembers";
import type { TeammateAgent } from "./teammates";
import type { StudioAgent } from "./useStudioAgents";

/**
 * What the person is doing in the studio, as in a life-sim: walking it and talking to the team,
 * hiring someone (from a free desk or the team list), or rebuilding the room (from the hotbar).
 * Each has its own panel on the left.
 */
export type StudioMode = "studio" | "hire" | "build";

/** B builds and Esc goes back to the studio; the number keys are the hotbar's. */
const modeKeys: Record<string, StudioMode> = { KeyB: "build", Escape: "studio" };

export const modeForKey = (code: string): StudioMode | undefined => modeKeys[code];

const order = { "needs-you": 0, working: 1, resting: 2 } as const;

/**
 * A panel down the left side of the room, in its top corner: the team, hiring or customizing, by
 * mode. It floats over the office as the chat's side cards do, stops above the chat bar, and gives
 * way on a narrow window, where the room needs the space.
 */
export function StudioSide({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <Surface
      as="aside"
      tone="scene-panel"
      radius="xl"
      className={cn(
        // Under the studio's top bar.
        "absolute top-14 left-2 z-[var(--stack-overlay)] flex max-h-[calc(100%-9rem)] w-62 flex-col",
        "gap-1 p-2 max-[792px]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** A side panel's title row: its name, and a count or a control at its end. */
export function StudioSideHead(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-8 items-center justify-between px-2">
      <Text as="h3" size="meta" weight="semibold" tone="bright">
        {props.title}
      </Text>
      {props.children}
    </header>
  );
}

/** A team row's layout, shared with its skeleton: the app's 32px row. */
const teamRowClass = cn(rowShape, "w-full text-meta");

/** The ring round a picture: a working or waiting agent's state, or a failed run. */
function ringColor(state: StudioAgent["state"], outcome?: string): ArtColor | undefined {
  if (outcome === "failed") return "red";
  return state === "working" ? "green" : state === "needs-you" ? "amber" : undefined;
}

/** The shared state mark at a row's end; a free agent with nothing new to see shows none. */
function rowMark(state: StudioAgent["state"], outcome?: string): StateMarkKind | null {
  if (state === "needs-you") return "waiting";
  if (state === "working") return "working";
  if (outcome === "failed") return "failed";
  if (outcome === "done") return "done";
  return null;
}

function TeamRow(props: {
  picture: ReactNode;
  name: string;
  owner?: string;
  mark: StateMarkKind | null;
  markLabel?: string;
  /** An agent's level, from the tasks it has finished. */
  level?: number;
  pressed: boolean;
  onPick(): void;
}) {
  return (
    <Surface
      as={Pressable}
      tone={props.pressed ? "well" : "none"}
      wash="control"
      className={teamRowClass}
      aria-pressed={props.pressed}
      onClick={props.onPick}
    >
      {props.picture}
      <Text tone={props.pressed ? "bright" : undefined} className="min-w-0 flex-1 text-left">
        {props.name}
      </Text>
      {props.owner ? (
        <Text tone="muted" className="max-w-20 flex-none">
          {props.owner}
        </Text>
      ) : null}
      {props.level ? <SceneBadge tint="yellow">Lv {props.level}</SceneBadge> : null}
      {props.mark ? <StateMark kind={props.mark} label={props.markLabel} /> : null}
    </Surface>
  );
}

/** A member's own picture, their initial without one. */
export function PersonAvatar(props: { name: string; picture?: string }) {
  return (
    <Avatar size="sm" aria-label={props.name}>
      {props.picture ? <AvatarImage src={props.picture} alt="" /> : null}
      <AvatarFallback>{initialOf(props.name)}</AvatarFallback>
    </Avatar>
  );
}

/** Whether figures' name tags (and what they say) show over the room; a choice of this computer. */
export const useStudioNames = createDeviceSetting<{ shown: boolean }>({
  scope: "agents/studio-names",
  defaults: { shown: true },
  normalize: (stored) => ({ shown: (stored as { shown?: unknown }).shown !== false }),
});

/** A group's quiet heading inside the team panel. */
function TeamGroup(props: { title: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="grid gap-0.5 pt-1">
      <Text as="h4" size="caption" tone="muted" className="m-0 flex h-6 items-center px-2">
        {props.title}
      </Text>
      {props.children}
    </section>
  );
}

/**
 * The team, as a game lists its party: who needs you, who is working, who finished something you
 * haven't looked at, who is free, and then the Space's other members' agents visiting the room.
 * Each row ends in the app's state mark; picking one goes to them. Its title row folds the panel
 * away to just that row, so the room shows, and opens it again.
 */
export function TeamPanel(props: {
  agents: StudioAgent[];
  /** Other members' agents in this Space, with their person's picture. */
  visitors: TeammateAgent[];
  /** The Space's other members here now, and where in Misty each is. */
  people: TeamMember[];
  /** Requests members sent this person for their agents, waiting for an answer. */
  requests: StudioRequest[];
  /** How runs ended that the person hasn't looked at yet. */
  outcomes: Map<string, "done" | "failed">;
  names: Map<string, string>;
  /** Each agent's level, from the tasks it has finished. */
  levels?: Map<string, number>;
  selected: string | null;
  loading: boolean;
  onPick(actorId: string): void;
  onHire(): void;
  /** Closes the list; the top bar's Team opens it again. */
  onClose(): void;
}) {
  const sorted = [...props.agents].sort((a, b) => order[a.state] - order[b.state]);
  const groupOf = (item: StudioAgent) =>
    item.state === "needs-you"
      ? "Needs you"
      : item.state === "working"
        ? "Working"
        : props.outcomes.has(item.agent.id)
          ? "Finished"
          : "Free";
  const groups = ["Needs you", "Working", "Finished", "Free"]
    .map((title) => ({ title, items: sorted.filter((item) => groupOf(item) === title) }))
    .filter((group) => group.items.length);
  return (
    <StudioSide aria-label="Team" data-tour="studio-team">
      <h3 className="m-0 flex-none">
        <Pressable
          wash="control"
          aria-expanded
          className={cn(rowShape, "w-full justify-between text-left")}
          onClick={props.onClose}
        >
          <Text bare size="meta" weight="semibold" tone="bright">
            Team
          </Text>
          <Text bare size="caption" tone="muted" className="flex items-center gap-1.5 tabular-nums">
            {props.loading ? null : props.agents.length}
            <ChevronDown aria-hidden="true" className="size-4 rotate-180" />
          </Text>
        </Pressable>
      </h3>
      {
        <>
          <div className="grid min-h-0 gap-0.5 overflow-y-auto">
            {props.loading
              ? Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className={teamRowClass} aria-hidden="true">
                    <Skeleton className="size-6 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))
              : groups.map((group) => (
                  <TeamGroup key={group.title} title={group.title}>
                    {group.items.map(({ agent, state }) => {
                      const outcome = props.outcomes.get(agent.id);
                      return (
                        <TeamRow
                          key={agent.id}
                          picture={
                            // A working or waiting agent's state as a ring round its picture.
                            <Surface
                              as="span"
                              tone="faint"
                              radius="full"
                              artRing={ringColor(state, outcome)}
                              className="relative grid size-6 flex-none place-items-center"
                            >
                              <AgentAvatar agent={agent} compact />
                            </Surface>
                          }
                          name={props.names.get(agent.id) ?? agent.name}
                          level={props.levels?.get(agent.id)}
                          mark={rowMark(state, outcome)}
                          pressed={props.selected === agent.id}
                          onPick={() => props.onPick(agent.id)}
                        />
                      );
                    })}
                  </TeamGroup>
                ))}
            {!props.loading && props.visitors.length ? (
              <TeamGroup title="Visiting">
                {props.visitors.map((mate) => {
                  const id = `guest:${mate.key}`;
                  return (
                    <TeamRow
                      key={mate.key}
                      picture={
                        // Whose it is: the person's own picture, their initial without one.
                        <Avatar size="sm" aria-label={mate.owner}>
                          {mate.ownerPicture ? (
                            <AvatarImage src={mate.ownerPicture} alt="" />
                          ) : null}
                          <AvatarFallback>
                            {(mate.owner.trim()[0] ?? "?").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      }
                      name={mate.name}
                      owner={mate.owner}
                      mark={rowMark(mate.state)}
                      pressed={props.selected === id}
                      onPick={() => props.onPick(id)}
                    />
                  );
                })}
              </TeamGroup>
            ) : null}
            {!props.loading && props.people.length ? (
              <TeamGroup title="People">
                {props.people.map((person) => {
                  const id = `member:${person.userId}`;
                  return (
                    <TeamRow
                      key={person.userId}
                      picture={<PersonAvatar name={person.name} picture={person.picture} />}
                      name={person.name}
                      owner={placeWords({ place: person.place })}
                      mark={person.active ? "online" : null}
                      pressed={props.selected === id}
                      onPick={() => props.onPick(id)}
                    />
                  );
                })}
              </TeamGroup>
            ) : null}
            {!props.loading && props.requests.length ? (
              <TeamGroup title="Requests">
                {props.requests.map((request) => {
                  const id = `member:${request.fromUserId}`;
                  const picture = props.people.find(
                    (person) => person.userId === request.fromUserId,
                  )?.picture;
                  return (
                    <TeamRow
                      key={request.id}
                      picture={<PersonAvatar name={request.fromName} picture={picture} />}
                      name={`From ${request.fromName}`}
                      mark="waiting"
                      markLabel="Waiting for you"
                      pressed={props.selected === id}
                      onPick={() => props.onPick(id)}
                    />
                  );
                })}
              </TeamGroup>
            ) : null}
          </div>
          {props.loading ? null : (
            <>
              <Separator className="my-1" />
              <Pressable
                wash="control"
                className={cn(teamRowClass, "text-left")}
                onClick={props.onHire}
              >
                <Text bare tone="muted" className="grid size-6 flex-none place-items-center">
                  <UserPlus aria-hidden="true" />
                </Text>
                <Text tone="muted" className="flex-1">
                  Hire someone
                </Text>
              </Pressable>
            </>
          )}
        </>
      }
    </StudioSide>
  );
}
