import { Settings, Shirt, Trophy, Undo2, Users, X } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import {
  ActionBar,
  cn,
  IconButton,
  iconBarItem,
  Pressable,
  rowShape,
  SceneBadge,
  SceneGlyph,
  Surface,
  Text,
} from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import type { StudioState } from "./useStudioAgents";

const stateWords = { working: "Working", "needs-you": "Needs you", resting: "Free" } as const;
const stateDot = { working: "green", "needs-you": "amber", resting: undefined } as const;

/** Who has the person's attention: the one agent what they say or type goes to. */
export interface StudioAttention {
  id: string;
  name: string;
  state: StudioState;
  agent?: AgentProfile;
  /** It was told to come to the person and keeps after them. */
  following: boolean;
}

/**
 * The studio's bar along the top, in Misty's own look: the team on the left, who has the person's
 * attention in the middle (pressing E by an agent gives it), and the studio's level on the right.
 * Each end opens its panel under the bar.
 */
export function StudioTopBar(props: {
  teamCount: number | null;
  teamOpen: boolean;
  onTeam(): void;
  attention: StudioAttention | null;
  onCustomize?(): void;
  onSettings?(): void;
  /** Sends a following agent back to its work. */
  onSendBack?(): void;
  /** Lets go of its attention. */
  onRelease(): void;
  level: number;
  trophies: number;
  levelOpen: boolean;
  onLevel(): void;
}) {
  const heard = props.attention;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 top-2 z-[var(--stack-overlay)] flex items-start",
        "justify-between gap-2 pr-[var(--window-chrome-right,0px)] max-[792px]:hidden",
      )}
      data-tour="studio-top-bar"
    >
      <Surface tone="scene-panel" radius="xl" className="pointer-events-auto p-1">
        <Pressable
          wash="control"
          selected={props.teamOpen}
          aria-expanded={props.teamOpen}
          className={cn(rowShape, "text-meta")}
          onClick={props.onTeam}
        >
          <Users aria-hidden="true" />
          <Text bare weight="semibold" tone="bright">
            Team
          </Text>
          {props.teamCount === null ? null : (
            <Text bare size="caption" tone="muted" className="tabular-nums">
              {props.teamCount}
            </Text>
          )}
        </Pressable>
      </Surface>
      {heard ? (
        <Surface
          tone="scene-panel"
          radius="xl"
          className="pointer-events-auto flex min-w-0 items-center gap-2 py-1 pr-1 pl-2.5"
          aria-label={`Talking to ${heard.name}`}
        >
          <AgentAvatar agent={heard.agent} compact />
          <Text bare size="meta" weight="semibold" tone="bright" className="truncate">
            {heard.name}
          </Text>
          <Text
            bare
            size="caption"
            tone="muted"
            className="inline-flex flex-none items-center gap-1.5"
          >
            <Surface
              as="span"
              tone="active"
              art={stateDot[heard.state]}
              radius="full"
              className="size-2"
              aria-hidden="true"
            />
            {heard.following ? "Following you" : stateWords[heard.state]}
          </Text>
          <ActionBar
            label={`${heard.name} actions`}
            size="sm"
            width="content"
            items={[
              ...(heard.following && props.onSendBack
                ? [
                    iconBarItem({
                      id: "send-back",
                      icon: Undo2,
                      label: "Send back to work",
                      size: "sm",
                      priority: 1,
                      onSelect: props.onSendBack,
                    }),
                  ]
                : []),
              ...(props.onCustomize
                ? [
                    iconBarItem({
                      id: "customize",
                      icon: Shirt,
                      label: "Customize",
                      size: "sm",
                      priority: 1,
                      onSelect: props.onCustomize,
                    }),
                  ]
                : []),
              ...(props.onSettings
                ? [
                    iconBarItem({
                      id: "settings",
                      icon: Settings,
                      label: `${heard.name} settings`,
                      size: "sm",
                      priority: 1,
                      onSelect: props.onSettings,
                    }),
                  ]
                : []),
            ]}
            end={
              <IconButton label="Stop talking" size="sm" onClick={props.onRelease}>
                <X aria-hidden="true" />
              </IconButton>
            }
          />
        </Surface>
      ) : null}
      <Surface tone="scene-panel" radius="xl" className="pointer-events-auto p-1">
        <Pressable
          wash="control"
          selected={props.levelOpen}
          aria-expanded={props.levelOpen}
          aria-label={`Studio level ${props.level}, ${props.trophies} unlocked`}
          className={cn(rowShape, "text-meta")}
          onClick={props.onLevel}
        >
          <SceneBadge tint="yellow">Lv {props.level}</SceneBadge>
          <Text bare size="caption" tone="muted" className="flex items-center gap-1 tabular-nums">
            <SceneGlyph tint="yellow">
              <Trophy aria-hidden="true" />
            </SceneGlyph>
            {props.trophies}
          </Text>
        </Pressable>
      </Surface>
    </div>
  );
}
