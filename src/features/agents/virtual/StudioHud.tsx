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
import type { ReactNode } from "react";
import { Pressable, Skeleton } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
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

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Free" } as const;
const outcomeWords: Record<string, string> = { done: "Done", failed: "Failed" };
const order = { "needs-you": 0, working: 1, resting: 2 } as const;

/**
 * The team, as a game lists its party: everyone who needs you first, then who is working, then
 * who is free, each with its state. Picking one goes to them.
 */
export function TeamPanel(props: {
  agents: StudioAgent[];
  /** How runs ended that the person hasn't looked at yet. */
  outcomes: Map<string, "done" | "failed">;
  names: Map<string, string>;
  selected: string | null;
  loading: boolean;
  onPick(agentId: string): void;
}) {
  const sorted = [...props.agents].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <aside className="virtual-studio-side virtual-studio-team" aria-label="Team">
      <header className="virtual-studio-side-head">
        <h3>Team</h3>
        {props.loading ? null : <span className="tabular-nums">{props.agents.length}</span>}
      </header>
      <div className="virtual-studio-team-list">
        {props.loading
          ? Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="virtual-studio-team-row" aria-hidden="true">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))
          : sorted.map(({ agent, state }) => (
              <Pressable
                key={agent.id}
                type="button"
                className="virtual-studio-team-row"
                data-state={state}
                data-outcome={props.outcomes.get(agent.id)}
                aria-pressed={props.selected === agent.id}
                onClick={() => props.onPick(agent.id)}
              >
                <span className="virtual-studio-team-avatar">
                  <AgentAvatar agent={agent} compact />
                </span>
                <span className="min-w-0 flex-1 truncate text-left">
                  {props.names.get(agent.id) ?? agent.name}
                </span>
                <span className="virtual-studio-team-state">
                  {outcomeWords[props.outcomes.get(agent.id) ?? ""] ?? stateWords[state]}
                </span>
              </Pressable>
            ))}
      </div>
    </aside>
  );
}

/**
 * The dock along the bottom, the one place the studio's controls live: which mode the person is
 * in, the box to talk to the team, and whether the camera looks over the room or walks in it.
 * Number keys pick a mode and V switches the camera.
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
  const cameras = [
    { walking: false, label: "Overview", icon: Box },
    { walking: true, label: "Walk", icon: Footprints },
  ];
  return (
    <div className="virtual-studio-dock">
      <div className="virtual-studio-segments" role="tablist" aria-label="Mode">
        {modes.map(({ id, label, key, icon: Icon }) => (
          <Pressable
            key={id}
            type="button"
            role="tab"
            aria-selected={props.mode === id}
            className="virtual-studio-segment"
            title={`${label} (${key})`}
            onClick={() => props.onMode(id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </Pressable>
        ))}
      </div>
      {props.children ? <div className="virtual-studio-dock-main">{props.children}</div> : null}
      <div className="virtual-studio-segments" role="radiogroup" aria-label="Camera">
        {cameras.map(({ walking, label, icon: Icon }) => (
          <Pressable
            key={label}
            type="button"
            role="radio"
            aria-checked={props.walking === walking}
            aria-label={label}
            className="virtual-studio-segment"
            data-icon-only="true"
            title={`${label} (V)`}
            onClick={() => props.onWalking(walking)}
          >
            <Icon size={15} aria-hidden="true" />
          </Pressable>
        ))}
      </div>
      <Pressable
        type="button"
        className="virtual-studio-segment"
        data-icon-only="true"
        aria-pressed={props.sounds}
        aria-label="Studio sounds"
        title="Studio sounds"
        onClick={() => props.onSounds(!props.sounds)}
      >
        {props.sounds ? (
          <Volume2 size={15} aria-hidden="true" />
        ) : (
          <VolumeX size={15} aria-hidden="true" />
        )}
      </Pressable>
    </div>
  );
}
