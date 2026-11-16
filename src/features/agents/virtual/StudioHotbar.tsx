import {
  Brain,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Disc3,
  Gamepad2,
  Hammer,
  Hand,
  HandHeart,
  ListChecks,
  Maximize,
  PartyPopper,
  Pointer,
  Smile,
  Tag,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import {
  appIcons,
  Button,
  cn,
  IconButton,
  OverflowFadeText,
  SceneBadge,
  SceneGlyph,
  SceneMeter,
  SceneSlot,
  type SceneTint,
  spaceIcons,
  Surface,
  Text,
} from "@/shared/ui";
import { furnitureIcons } from "./furnitureIcons";
import type { StudioEmote } from "./studioOrders";
import type { Quest } from "./studioQuests";
import {
  POINTS,
  unlockLabel,
  unlocks,
  type Progress as StudioProgress,
  type StudioTally,
  type Unlock,
} from "./studioProgress";

/*
 * The studio's game-style HUD, after the simulator games' layout: a small hotbar along the bottom
 * with the studio's level filling over it, an emote picker, the studio's level and today's quests
 * in the top right, and a banner when something is unlocked.
 */

/** The hotbar's keys: emotes, the Space's games, the music player, and building. */
export const EMOTE_KEY = "Digit1";
export const GAMES_KEY = "Digit2";
export const MUSIC_KEY = "Digit3";
export const BUILD_KEY = "KeyB";
/** Shows or hides the level card. */
export const LEVEL_KEY = "KeyL";

/** Whether the level card shows in the top right; this device remembers it. The top bar's
 * level, and L, bring it back once it is hidden. */
export const useLevelCardShown = createDeviceSetting<{ shown: boolean }>({
  scope: "agents/studio-level-card",
  defaults: { shown: true },
  normalize: (stored) => ({ shown: (stored as { shown?: unknown }).shown !== false }),
});

const toggleLevelCard = () => {
  const card = useLevelCardShown.getState();
  card.set({ shown: !card.value.shown });
};

export const emotes: { emote: StudioEmote; label: string; icon: LucideIcon }[] = [
  { emote: "wave", label: "Wave", icon: Hand },
  { emote: "cheer", label: "Cheer", icon: PartyPopper },
  { emote: "dance", label: "Dance", icon: Disc3 },
  { emote: "clap", label: "Clap", icon: HandHeart },
  { emote: "think", label: "Think", icon: Brain },
  { emote: "point", label: "Point", icon: Pointer },
];

/**
 * The hotbar along the bottom, numbered as a game's is, with only what does something: act out an
 * emote, play the Space's games, put on music, rebuild the room, and at its end the name tags over
 * the figures, lit while they show. Over it, the studio's level fills toward the next one, the way a game shows
 * experience. Where everyone goes is up to their work (and to what they are told in chat), not to
 * the hotbar. Hiring has no slot: it is done at a free desk, or from the team list.
 */
export function StudioHotbar(props: {
  emoteOpen: boolean;
  onEmoteOpen(open: boolean): void;
  onGames(): void;
  /** The music player is showing. */
  music: boolean;
  onMusic(): void;
  onBuild(): void;
  progress: StudioProgress;
  /** Name tags over the figures. N does the same. */
  names: boolean;
  onNames(shown: boolean): void;
}) {
  const { progress } = props;
  const level = progress.reached.length + 1;
  const next = progress.next;
  return (
    <Surface
      tone="scene-panel"
      radius="xl"
      className={cn(
        "absolute inset-x-0 bottom-2 z-[var(--stack-overlay)] mx-auto grid w-80 max-w-[calc(100%-1rem)]",
        "gap-1 px-1 pt-2 pb-1",
        "max-[792px]:group-data-[talking]/studio:hidden",
      )}
      data-tour="studio-hotbar"
    >
      <div className="flex items-center gap-2 px-1.5">
        <SceneBadge tint="yellow">Lv {level}</SceneBadge>
        <SceneMeter
          tint="green"
          className="flex-1"
          value={next ? (progress.points / next.at) * 100 : 100}
          label={
            next
              ? `Studio level ${level}: ${progress.points} of ${next.at} points to the next`
              : `Studio level ${level}`
          }
        />
        <Text bare size="caption" tone="muted" className="flex-none tabular-nums">
          {next ? `${progress.points}/${next.at}` : progress.points}
        </Text>
      </div>
      <div role="toolbar" aria-label="Hotbar" className="flex items-center justify-center gap-0.5">
        <SceneSlot
          icon={<Smile aria-hidden="true" />}
          keyName="1"
          tint="yellow"
          aria-label="Emotes"
          aria-expanded={props.emoteOpen}
          selected={props.emoteOpen}
          onClick={() => props.onEmoteOpen(!props.emoteOpen)}
        >
          Emote
        </SceneSlot>
        <SceneSlot
          icon={<Gamepad2 aria-hidden="true" />}
          keyName="2"
          tint="red"
          aria-label="Play the Space's games"
          onClick={props.onGames}
        >
          Games
        </SceneSlot>
        <SceneSlot
          icon={<MusicIcon aria-hidden="true" />}
          keyName="3"
          tint="purple"
          aria-label="Music"
          aria-expanded={props.music}
          selected={props.music}
          onClick={props.onMusic}
        >
          Music
        </SceneSlot>
        <SceneSlot
          icon={<Hammer aria-hidden="true" />}
          keyName="B"
          tint="orange"
          aria-label="Build"
          onClick={props.onBuild}
        >
          Build
        </SceneSlot>
        <SceneSlot
          icon={<Tag aria-hidden="true" />}
          keyName="N"
          tint="blue"
          aria-label="Name tags"
          selected={props.names}
          onClick={() => props.onNames(!props.names)}
        >
          Names
        </SceneSlot>
      </div>
    </Surface>
  );
}

/**
 * The emote picker, over the hotbar: whatever is picked is acted out by the person's own figure
 * while they walk the room, otherwise by the picked agent, otherwise by the whole team. Number
 * keys pick one while it is open.
 */
export function EmotePicker(props: {
  /** Who acts it out, for its title. */
  who: string;
  onEmote(emote: StudioEmote): void;
  onClose(): void;
}) {
  return (
    <Surface
      tone="scene-panel"
      radius="xl"
      role="menu"
      aria-label={`Emotes for ${props.who}`}
      className="absolute inset-x-0 bottom-28 z-[var(--stack-overlay)] mx-auto grid w-fit gap-1 p-1"
    >
      <header className="flex h-7 items-center justify-between gap-2 pl-2">
        <Text as="h3" size="meta" weight="semibold" tone="bright">
          {props.who}
        </Text>
        <IconButton label="Close" size="sm" onClick={props.onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div className="flex gap-0.5">
        {emotes.map(({ emote, label, icon: Icon }, index) => (
          <SceneSlot
            key={emote}
            role="menuitem"
            tint="yellow"
            icon={<Icon aria-hidden="true" />}
            keyName={String(index + 1)}
            onClick={() => props.onEmote(emote)}
          >
            {label}
          </SceneSlot>
        ))}
      </div>
    </Surface>
  );
}

const MusicIcon = appIcons.music;

/** An unlock's glyph: the piece's own, or a room growing. */
function UnlockIcon({ unlock }: { unlock: Unlock }) {
  const Icon = "kind" in unlock ? furnitureIcons[unlock.kind] : Maximize;
  return <Icon aria-hidden="true" />;
}

/** Where the studio's points come from, each with its own glyph: what the tally counts. */
const sources: {
  key: keyof StudioTally;
  label: string;
  icon: LucideIcon;
  tint: SceneTint;
  points: (tally: StudioTally) => number;
}[] = [
  {
    key: "tasks",
    label: "Tasks finished",
    icon: CheckCheck,
    tint: "green",
    points: (t) => t.tasks * POINTS.task,
  },
  {
    key: "agents",
    label: "Agents",
    icon: appIcons.agents,
    tint: "blue",
    points: (t) => t.agents * POINTS.agent,
  },
  {
    key: "members",
    label: "Members",
    icon: Users,
    tint: "purple",
    points: (t) => t.members * POINTS.member,
  },
  {
    key: "notes",
    label: "Notes",
    icon: spaceIcons.docs,
    tint: "sand",
    points: (t) => Math.floor(t.notes / 2) * POINTS.notes,
  },
  {
    key: "games",
    label: "Games made",
    icon: Gamepad2,
    tint: "red",
    points: (t) => t.games * POINTS.game,
  },
  {
    key: "quests",
    label: "Quests done",
    icon: ListChecks,
    tint: "orange",
    points: (t) => t.quests * POINTS.quest,
  },
];

/** Each daily quest's own glyph and tint, the same as the points it is counted under. */
const questLooks: Record<Quest["id"], { icon: LucideIcon; tint: SceneTint }> = {
  tasks: { icon: CheckCheck, tint: "green" },
  talk: { icon: appIcons.agents, tint: "blue" },
  group: { icon: Users, tint: "purple" },
};

/** Something done or unlocked, ticked off in green. */
const doneMark = (label: string) => (
  <SceneGlyph tint="green">
    <Check aria-label={label} />
  </SceneGlyph>
);

/** One row of the open tracker: a glyph, its words, and what sits at its end. */
function GoalRow(props: { icon: ReactNode; label: string; end: ReactNode; dim?: boolean }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2">
      <Text bare tone="muted" className="grid size-6 flex-none place-items-center">
        {props.icon}
      </Text>
      <Text bare size="meta" tone={props.dim ? "muted" : "default"} className="flex min-w-0 flex-1">
        <OverflowFadeText>{props.label}</OverflowFadeText>
      </Text>
      <Text bare size="caption" tone="muted" className="flex-none tabular-nums">
        {props.end}
      </Text>
    </div>
  );
}

/** A small heading inside the level card. */
function CardHeading(props: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-2">
      <Text as="h4" size="caption" weight="semibold" tone="muted" className="flex-1">
        {props.children}
      </Text>
      {props.end ? (
        <Text bare size="caption" tone="muted" className="tabular-nums">
          {props.end}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * The studio's level in the top right, as a game shows a player's: the level and its trophies,
 * the next unlock with a bar filling toward it, and today's quests. Opened, it also lists where
 * the points come from and every unlock, those reached ticked off.
 */
export function LevelCard(props: {
  progress: StudioProgress;
  tally: StudioTally;
  quests: Quest[];
}) {
  const { progress, tally, quests } = props;
  const [open, setOpen] = useState(false);
  const next = progress.next;
  const level = progress.reached.length + 1;
  const share = next ? (progress.points / next.at) * 100 : 100;
  const doneToday = quests.filter((quest) => quest.have >= quest.need).length;
  return (
    <Surface
      as="aside"
      tone="scene-panel"
      radius="xl"
      aria-label="Studio level"
      data-tour="studio-level"
      className={cn(
        "absolute top-14 right-[calc(0.5rem+var(--window-chrome-right,0px))] z-[var(--stack-overlay)]",
        "grid max-h-[calc(100%-12rem)] w-68 gap-2 overflow-y-auto p-3 max-[792px]:hidden",
      )}
    >
      <header className="flex items-center gap-2">
        <SceneBadge tint="yellow">Lv {level}</SceneBadge>
        <Text as="h3" size="meta" weight="semibold" tone="bright" className="flex-1">
          Studio level {level}
        </Text>
        <Text bare size="caption" tone="muted" className="flex items-center gap-1 tabular-nums">
          <SceneGlyph tint="yellow">
            <Trophy aria-hidden="true" />
          </SceneGlyph>
          {progress.reached.length}
        </Text>
        <IconButton
          label={open ? "Hide points and unlocks" : "Show points and unlocks"}
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((known) => !known)}
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </IconButton>
        <IconButton label="Hide studio level" shortcut="L" size="sm" onClick={toggleLevelCard}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      {next ? (
        <div className="grid gap-1.5">
          <SceneMeter
            tint="green"
            value={share}
            label={`${progress.points} of ${next.at} points toward ${unlockLabel(next)}`}
          />
          <GoalRow
            icon={<UnlockIcon unlock={next} />}
            label={`Next: ${unlockLabel(next)}`}
            end={`${progress.points}/${next.at}`}
          />
        </div>
      ) : (
        <Text bare size="meta" tone="default">
          Everything is unlocked.
        </Text>
      )}
      <section aria-label="Today's quests" className="grid">
        <CardHeading end={`${doneToday} of ${quests.length}`}>Today</CardHeading>
        {quests.map((quest) => {
          const { icon: Icon, tint } = questLooks[quest.id];
          const done = quest.have >= quest.need;
          return (
            <GoalRow
              key={quest.id}
              icon={
                <SceneGlyph tint={tint}>
                  <Icon aria-hidden="true" />
                </SceneGlyph>
              }
              label={quest.label}
              dim={done}
              end={done ? doneMark("Done") : `${quest.have}/${quest.need}`}
            />
          );
        })}
      </section>
      {open ? (
        <>
          <section aria-label="Points" className="grid">
            <CardHeading end={progress.points}>Points</CardHeading>
            {sources.map(({ key, label, icon: Icon, tint, points }) => (
              <GoalRow
                key={key}
                icon={
                  <SceneGlyph tint={tint}>
                    <Icon aria-hidden="true" />
                  </SceneGlyph>
                }
                label={`${label} · ${tally[key]}`}
                end={`+${points(tally)}`}
              />
            ))}
          </section>
          <section aria-label="Unlocks" className="grid">
            <CardHeading>Unlocks</CardHeading>
            {unlocks.map((unlock) => {
              const reached = unlock.at <= progress.points;
              return (
                <GoalRow
                  key={unlock.id}
                  icon={<UnlockIcon unlock={unlock} />}
                  label={unlockLabel(unlock)}
                  dim={!reached}
                  end={reached ? doneMark("Unlocked") : unlock.at}
                />
              );
            })}
          </section>
        </>
      ) : null}
    </Surface>
  );
}

/**
 * Said once when the studio earns something: what it was, and for furniture the way to place it.
 * The team cheers at the same moment, in the room.
 */
export function UnlockBanner(props: { unlock: Unlock; onBuild(): void; onClose(): void }) {
  const { unlock } = props;
  return (
    <Surface
      tone="scene-panel"
      radius="xl"
      role="status"
      className="absolute inset-x-0 top-14 z-[var(--stack-overlay)] mx-auto flex w-fit max-w-[calc(100%-1rem)] items-center gap-2 py-1.5 pr-1.5 pl-3"
    >
      <Text bare tone="bright" className="grid size-5 flex-none place-items-center">
        <SceneGlyph tint="yellow">
          <UnlockIcon unlock={unlock} />
        </SceneGlyph>
      </Text>
      <Text bare size="meta" tone="bright" className="flex min-w-0">
        <OverflowFadeText>Unlocked: {unlockLabel(unlock)}</OverflowFadeText>
      </Text>
      {"kind" in unlock ? (
        <Button size="sm" onClick={props.onBuild}>
          Place it
        </Button>
      ) : null}
      <IconButton label="Close" size="sm" onClick={props.onClose}>
        <X aria-hidden="true" />
      </IconButton>
    </Surface>
  );
}
