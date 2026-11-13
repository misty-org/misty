import {
  Box,
  Footprints,
  Hammer,
  LayoutGrid,
  UserPlus,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  IconButton,
  Pressable,
  Separator,
  Skeleton,
  StateMark,
  Surface,
  Text,
  ToolbarDivider,
  Tooltip,
  type ArtColor,
  type StateMarkKind,
} from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import type { TeammateAgent } from "./teammates";
import type { StudioAgent } from "./useStudioAgents";

/**
 * What the person is doing in the studio, as in a life-sim: watching and talking to the team,
 * hiring someone, or rebuilding the room. Each has its own panel on the left.
 */
export type StudioMode = "studio" | "hire" | "build";

const modes: { id: StudioMode; label: string; key: string; icon: LucideIcon }[] = [
  { id: "studio", label: "Studio", key: "1", icon: LayoutGrid },
  { id: "hire", label: "Hire", key: "2", icon: UserPlus },
  { id: "build", label: "Build", key: "3", icon: Hammer },
];

export const modeForKey = (code: string): StudioMode | undefined =>
  modes.find((mode) => code === `Digit${mode.key}`)?.id;

const order = { "needs-you": 0, working: 1, resting: 2 } as const;

/**
 * A panel down the left side of the room: the team, hiring or customizing, by mode. It floats over
 * the office as the chat's side cards do, 8px from the edges, and gives way on a narrow window,
 * where the room needs the space.
 */
export function StudioSide({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <Surface
      as="aside"
      tone="scene-panel"
      radius="xl"
      className={cn(
        "absolute top-2 left-2 z-[var(--stack-overlay)] flex max-h-[calc(100%-5.5rem)] w-62 flex-col",
        "gap-1 p-2 max-[720px]:hidden",
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
const teamRowClass = "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-meta";

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
      {props.mark ? <StateMark kind={props.mark} label={props.markLabel} /> : null}
    </Surface>
  );
}

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
 * Each row ends in the app's state mark; picking one goes to them.
 */
export function TeamPanel(props: {
  agents: StudioAgent[];
  /** Other members' agents in this Space, with their person's picture. */
  visitors: TeammateAgent[];
  /** How runs ended that the person hasn't looked at yet. */
  outcomes: Map<string, "done" | "failed">;
  names: Map<string, string>;
  selected: string | null;
  loading: boolean;
  onPick(actorId: string): void;
  onHire(): void;
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
      <StudioSideHead title="Team">
        {props.loading ? null : (
          <Text bare size="caption" tone="muted" className="tabular-nums">
            {props.agents.length}
          </Text>
        )}
      </StudioSideHead>
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
                      {mate.ownerPicture ? <AvatarImage src={mate.ownerPicture} alt="" /> : null}
                      <AvatarFallback>{(mate.owner.trim()[0] ?? "?").toUpperCase()}</AvatarFallback>
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
    </StudioSide>
  );
}

/**
 * The dock along the bottom, the one place the studio's controls live, standing bare in one row:
 * the mode, the box to talk to the team, then the camera and the sounds. Number keys pick a mode
 * and V switches the camera.
 */
export function StudioDock(props: {
  mode: StudioMode;
  onMode(mode: StudioMode): void;
  walking: boolean;
  onWalking(walking: boolean): void;
  /** Whether the studio makes sounds; off unless the person turns them on. */
  sounds: boolean;
  onSounds(on: boolean): void;
  children?: ReactNode;
}) {
  const Camera = props.walking ? Footprints : Box;
  return (
    <Surface
      tone="scene-panel"
      radius="xl"
      role="toolbar"
      aria-label="Studio"
      className={cn(
        "absolute inset-x-0 bottom-2 z-[var(--stack-overlay)] mx-auto flex w-fit max-w-[calc(100%-1rem)]",
        "items-center gap-1 p-2",
        // On a narrow window the talk panel takes the bottom, so the dock goes while it is open.
        "max-[720px]:group-data-[talking]/studio:hidden",
      )}
    >
      <div
        role="group"
        aria-label="Mode"
        className="flex flex-none gap-0.5"
        data-tour="studio-mode"
      >
        {modes.map(({ id, label, key, icon }) => (
          <Tooltip key={id} content={label} shortcut={key}>
            <Button
              variant="quiet"
              icon={icon}
              aria-pressed={props.mode === id}
              onClick={() => props.onMode(id)}
            >
              {label}
            </Button>
          </Tooltip>
        ))}
      </div>
      {props.children ? (
        <>
          <ToolbarDivider />
          {/* A fixed width, so the box never pushes the buttons after it out of the dock. */}
          <div className="w-80 min-w-0 max-w-[40vw] flex-none" data-tour="studio-ask">
            {props.children}
          </div>
        </>
      ) : null}
      <ToolbarDivider />
      <div className="flex flex-none gap-0.5" data-tour="studio-camera">
        <IconButton
          label={props.walking ? "Camera: walking" : "Camera: overview"}
          shortcut="V"
          aria-pressed={props.walking}
          onClick={() => props.onWalking(!props.walking)}
        >
          <Camera />
        </IconButton>
        <IconButton
          label={props.sounds ? "Turn studio sounds off" : "Turn studio sounds on"}
          onClick={() => props.onSounds(!props.sounds)}
        >
          {props.sounds ? <Volume2 /> : <VolumeX />}
        </IconButton>
      </div>
    </Surface>
  );
}
