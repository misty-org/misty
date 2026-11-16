import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, ErrorState, Kbd, SceneCrosshair, Skeleton, Surface, Text } from "@/shared/ui";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { currentSpaceKey } from "../engines/enginesApi";
import { listenForActionQuestions, useActionQuestions } from "../island/actionQuestions";
import { useAgentAccountId } from "../personal/agentAccount";
import { AgentTalk } from "./AgentTalk";
import { ArcadePanel } from "./ArcadePanel";
import { MusicPanel } from "./MusicPanel";
import { useStudioMusic } from "./studioMusic";
import { BuildPanel } from "./BuildPanel";
import { HirePanel } from "./HireAgent";
import { modeForKey, TeamPanel, useStudioNames, type StudioMode } from "./StudioHud";
import { CustomizePanel } from "./CustomizePanel";
import { typingIn } from "./studio/keys";
import { assignDesk, deskOwners } from "./studio/layout";
import { canDrawRoom, SceneBoundary } from "./studio/SceneBoundary";
import { useStudioLooks } from "./studioLooks";
import { useSpokenReplies } from "./studioVoices";
import type { Actor } from "./studio/behaviour";
import { useStudioLayout } from "./studio/layoutStore";
import { StudioBox } from "./StudioBox";
import { StudioTopBar } from "./StudioTopBar";
import { studioNames } from "./studioNames";
import { boardOf, huddledAgents, useStudioSpeech, useStudioTalk } from "./studioTalk";
import { finishedRuns, useStudioResults, waitingResults } from "./studioResults";
import { useSteadyStates } from "./steady";
import { MemberTalk } from "./MemberTalk";
import { claimedByOthers, fileName, useTeammateAgents, type TeammateAgent } from "./teammates";
import { placeWords } from "./teamMembers";
import { useStudioPeople } from "./useStudioPeople";
import { useStudioAgents, type StudioAgent } from "./useStudioAgents";
import {
  EMOTE_KEY,
  EmotePicker,
  MUSIC_KEY,
  LevelCard,
  LEVEL_KEY,
  useLevelCardShown,
  StudioHotbar,
  UnlockBanner,
  emotes,
  GAMES_KEY,
} from "./StudioHotbar";
import {
  EMOTE_MS,
  SAY_MS,
  followStudioOrders,
  placeHolds,
  useStudioOrders,
  type StudioEmote,
  type StudioPlace,
} from "./studioOrders";
import { markUnlocksSeen, seenUnlocks, type Unlock } from "./studioProgress";
import { useStudioProgress } from "./useStudioProgress";

/** three.js is big, so the room's code is fetched while the agents and the layout load. */
const loadScene = () => import("./studio/StudioScene");
const StudioScene = lazy(loadScene);

/** The walking controls, in the bottom right, shown for a while each time walking starts. */
const hintClass = cn(
  "absolute right-[calc(0.5rem+var(--window-chrome-right,0px))] bottom-2 z-[var(--stack-overlay)]",
  "flex items-center gap-2 py-1.5 pr-3 pl-1.5 max-[792px]:hidden",
  "animate-[misty-fade-in_0.3s_ease-out] motion-reduce:animate-none",
);
/** How long the walking controls stay up. */
const HINT_MS = 7000;
/** How long a "+1" rises off an agent that finished a task. */
const POP_MS = 1900;

/** The chat bar in the bottom left: the box that takes a message for any agent. */
const chatBarClass = cn(
  "absolute bottom-2 left-2 z-[var(--stack-overlay)] w-80 max-w-[calc(100%-1rem)] p-1 max-[1040px]:w-64",
  "max-[792px]:group-data-[talking]/studio:hidden",
);

/** How long a finished or failed run stays marked when the person hasn't looked at its agent. */
const OUTCOME_MS = 30 * 60_000;
/** How often orders are looked at again, to see which have run out. */
const ORDER_CHECK_MS = 4000;
/** How long the note that something was unlocked stays up. */
const UNLOCK_NOTE_MS = 9000;

/** The shape of the studio while it loads: the room, the row of agents and the build button. */
function StudioSkeleton() {
  return (
    <div
      className="absolute inset-0 grid place-items-center px-[10%] pt-18 pb-12"
      aria-hidden="true"
    >
      <Skeleton className="aspect-[20/11] w-full max-w-220 rounded-[1.75rem]" />
    </div>
  );
}

/**
 * The Space's agents as a studio to look into and talk in: each has a desk and types at it while
 * it works, comes to the door and waves when it needs its person, and drifts around the lounge when
 * it has nothing to do. A finished task leaves its result on the agent's desk until the person
 * walks up and collects it (`studioResults.ts`). Picking a figure, or walking up to it, opens a panel to talk to it and
 * answer what it asks; the box along the bottom takes a message for any of them, or a task for
 * several together. Teammates' agents drop by as visitors. Build mode rearranges the furniture,
 * which is kept per Space on this computer. It only shows what the runs report.
 */
export function VirtualStudio(props: {
  onOpenChat(agentId: string, conversationId: string): void;
  /** Opens an agent's settings: its engine, model and instructions. */
  onAgentSettings(agentId: string): void;
}) {
  const { agents: everyone, loading: agentsLoading, entries } = useStudioAgents();
  // Misty's own built-in agent isn't one of the team: the studio is for the person's engines.
  const reported = useMemo(() => everyone.filter((item) => !item.agent.system_managed), [everyone]);
  const teammates = useTeammateAgents((state) => state.agents);
  const people = useStudioPeople();
  const questions = useActionQuestions((state) => state.items);
  const conversations = useMistyStore((state) => state.conversations);
  const chats = useStudioTalk((state) => state.chats);
  const huddles = useStudioTalk((state) => state.huddles);
  const { layout, change, reset } = useStudioLayout(currentSpaceKey());
  const loading = agentsLoading || !layout;
  const [selected, pick] = useState<string | null>(null);
  /** When the person last looked at each agent: a run that ended before then is no news. */
  const [seen, setSeen] = useState<Record<string, number>>({});
  const setSelected = useCallback((id: string | null) => {
    pick(id);
    if (id) setSeen((known) => ({ ...known, [id]: Date.now() }));
  }, []);
  const [mode, setMode] = useState<StudioMode>("studio");
  /** Walking looks out of the person's own eyes; wheeled out, it is over their shoulder. */
  const [firstPerson, setFirstPerson] = useState(true);
  // The studio is walked through, as a game is played; only building looks down on the room.
  const [near, setNear] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  /** The agent being dressed up in the Customize panel, if any. */
  const [customizing, setCustomizing] = useState<string | null>(null);
  /** The team list, opened from the top bar. */
  const [teamOpen, setTeamOpen] = useState(false);
  const looks = useStudioLooks((state) => state.looks);
  // Read again when another account signs in: each keeps its own looks.
  const account = useAgentAccountId();
  useEffect(() => void useStudioLooks.getState().load(), [account]);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  /** The free desk Hire was opened for, if any. */
  const [hireDesk, setHireDesk] = useState<string | undefined>();
  const building = mode === "build";
  const walking = !building;
  /** The studio fills the screen, the window too, with the rest of Misty out of sight. */
  const [fullscreen, setFullscreen] = useState(false);
  /** Whether the studio put the window in full screen, so it only ever undoes its own. */
  const madeFullscreen = useRef(false);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const window = getCurrentWindow();
    if (fullscreen) {
      void window
        .isFullscreen()
        .then((already) => {
          if (already) return;
          madeFullscreen.current = true;
          return window.setFullscreen(true);
        })
        .catch(() => undefined);
    } else if (madeFullscreen.current) {
      madeFullscreen.current = false;
      void window.setFullscreen(false).catch(() => undefined);
    }
  }, [fullscreen]);
  // Leaving the studio leaves the full screen it entered.
  useEffect(
    () => () => {
      if (madeFullscreen.current && hasTauriInternals())
        void getCurrentWindow()
          .setFullscreen(false)
          .catch(() => undefined);
    },
    [],
  );
  /** Bumped by "Try again" after the room failed to draw, which mounts the scene afresh. */
  const [sceneKey, setSceneKey] = useState(0);
  const drawable = useMemo(canDrawRoom, []);
  const orders = useStudioOrders((state) => state.orders);
  /** The clock orders are read against, moved on every few seconds. */
  const [now, setNow] = useState(() => Date.now());
  const [emoteOpen, setEmoteOpen] = useState(false);
  /** What the person's own figure is acting out in walk mode. */
  const [myEmote, setMyEmote] = useState<{ kind: StudioEmote; at: number } | null>(null);
  const [arcadeOpen, setArcadeOpen] = useState(false);
  /** Something just unlocked, said once. */
  const [unlocked, setUnlocked] = useState<Unlock | null>(null);

  useEffect(() => followStudioOrders(), []);
  // A player left playing while the studio was away is still the studio's.
  useEffect(() => void useStudioMusic.getState().sync(), []);
  const musicShown = useStudioMusic((state) => state.shown);
  const namesShown = useStudioNames((state) => state.value.shown);
  const levelCardShown = useLevelCardShown((state) => state.value.shown);
  const toggleMusic = useCallback(() => {
    const music = useStudioMusic.getState();
    if (music.shown) music.hide();
    else music.show();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ORDER_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    // An order coming in is acted on at once, not at the next look at the clock.
    setNow(Date.now());
  }, [orders]);

  useEffect(() => void loadScene().catch(() => undefined), []);
  useEffect(() => listenForActionQuestions(), []);
  useEffect(() => {
    const store = useMistyStore.getState();
    if (store.accountId && !store.conversations.length && !store.conversationsLoading)
      void store.loadConversations();
  }, []);

  // An agent with a question waiting needs its person, whatever its run last reported.
  const asking = useMemo(() => new Set(questions.map((question) => question.agentId)), [questions]);
  const withQuestions = useMemo(
    () =>
      reported.map((item) =>
        asking.has(item.agent.id) && item.state !== "needs-you"
          ? { ...item, state: "needs-you" as const, doing: "Needs you" }
          : item,
      ),
    [reported, asking],
  );
  const keyed = useMemo(
    () => withQuestions.map((item) => ({ ...item, id: item.agent.id })),
    [withQuestions],
  );
  const agents: StudioAgent[] = useSteadyStates(keyed);
  const names = useMemo(
    () =>
      studioNames(
        agents.map(({ agent }) => ({ id: agent.id, name: agent.name, role: agent.role })),
      ),
    [agents],
  );
  // What each agent was told to do, and what of it still holds.
  const directed = useMemo(() => {
    const places = new Map<string, StudioPlace>();
    const acts = new Map<string, { kind: StudioEmote; at: number }>();
    const said = new Map<string, string>();
    for (const item of agents) {
      const id = item.agent.id;
      const order = orders[id];
      if (!order) continue;
      const run = { runId: item.runId, working: item.state === "working", endedAt: item.endedAt };
      if (order.place && placeHolds(order, run, now)) places.set(id, order.place);
      if (order.emote && order.emotedAt && now - order.emotedAt < EMOTE_MS + ORDER_CHECK_MS)
        acts.set(id, { kind: order.emote, at: order.emotedAt });
      if (order.say && order.saidAt && now - order.saidAt < SAY_MS) said.set(id, order.say);
    }
    return { places, acts, said };
  }, [agents, orders, now]);
  useEffect(() => {
    // The studio notes which run a new place order belongs to, and lets go of those run out.
    const store = useStudioOrders.getState();
    for (const item of agents) {
      const id = item.agent.id;
      const order = orders[id];
      if (!order?.place) continue;
      if (order.runId === undefined) store.attach(id, item.runId);
      else if (!directed.places.has(id)) store.release(id);
    }
  }, [agents, orders, directed]);
  const huddled = useMemo(() => huddledAgents(huddles, conversations), [huddles, conversations]);
  const talked = useStudioSpeech(chats);
  // What an agent said with its studio tools shows over its head too, after anything it answered.
  const speech = useMemo(() => {
    if (!directed.said.size) return talked;
    const all = new Map(talked);
    for (const [id, words] of directed.said) if (!all.has(id)) all.set(id, words);
    return all;
  }, [talked, directed.said]);
  const board = useMemo(
    () => boardOf(huddles, conversations, Date.now()),
    [huddles, conversations],
  );
  const outcomes = useMemo(() => {
    const now = Date.now();
    const shown = new Map<string, "done" | "failed">();
    for (const item of agents) {
      const fresh = now - item.endedAt < OUTCOME_MS && item.endedAt > (seen[item.agent.id] ?? 0);
      if (item.outcome && fresh) shown.set(item.agent.id, item.outcome);
    }
    return shown;
  }, [agents, seen]);

  const actors = useMemo<Actor[]>(
    () => [
      ...agents.map(({ agent, state, doing, doingCode, task, files }) => ({
        id: agent.id,
        kind: "agent" as const,
        files,
        clash: clashLine(files, teammates),
        name: agent.name,
        owner: "",
        guest: false,
        state,
        doing,
        doingCode,
        role: agent.role,
        task: state === "working" ? task : "",
        engine: agent.engine,
        huddle: state === "working" && huddled.has(agent.id),
        outcome: outcomes.get(agent.id) ?? "",
        order: directed.places.get(agent.id),
        emote: directed.acts.get(agent.id),
      })),
      ...teammates.map((mate) => ({
        id: `guest:${mate.key}`,
        name: mate.name,
        owner: mate.owner,
        guest: true,
        kind: "agent" as const,
        ownerId: mate.userId,
        agentId: mate.agentId,
        state: mate.state,
        doing: mate.doing,
        doingCode: "",
      })),
      ...people.memberActors,
    ],
    [agents, teammates, huddled, outcomes, people.memberActors, directed],
  );
  // Finished tasks' results wait on their agents' desks until the person collects them.
  const collected = useStudioResults((state) =>
    state.account === account ? state.collected : null,
  );
  useEffect(() => {
    if (!loading && account) useStudioResults.getState().start(account, finishedRuns(agents));
  }, [loading, account, agents]);
  const results = useMemo(() => waitingResults(agents, collected), [agents, collected]);
  const resultIds = useMemo(() => new Set(results.keys()), [results]);
  // Asked aloud, an agent answers aloud in its own voice.
  useSpokenReplies();
  const ownIds = useMemo(() => agents.map((item) => item.agent.id), [agents]);
  const spaceKey = people.spaceId || currentSpaceKey();
  const {
    progress,
    tally,
    records,
    quests,
    ready: progressReady,
  } = useStudioProgress({
    account,
    spaceId: spaceKey,
    agentIds: ownIds,
    entries,
  });
  const reachedIds = progress.reached.map((unlock) => unlock.id).join(",");
  useEffect(() => {
    if (!spaceKey || !progressReady || loading) return;
    const ids = reachedIds ? reachedIds.split(",") : [];
    const seen = seenUnlocks(spaceKey);
    // The first look at a studio takes what it already has as known, with nothing to celebrate.
    if (!seen) {
      markUnlocksSeen(spaceKey, ids);
      return;
    }
    const fresh = progress.reached.filter((unlock) => !seen.has(unlock.id));
    if (!fresh.length) return;
    markUnlocksSeen(spaceKey, ids);
    setUnlocked(fresh[fresh.length - 1]!);
    // The whole team cheers it.
    const store = useStudioOrders.getState();
    for (const id of ownIds) store.give(id, { emote: "cheer", emotedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the reached ids stand for `progress`
  }, [reachedIds, spaceKey, progressReady, loading]);
  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => setUnlocked(null), UNLOCK_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [unlocked]);
  const openGames = useCallback(() => setArcadeOpen(true), []);
  const customizingAgent = agents.find((item) => item.agent.id === customizing)?.agent ?? undefined;
  const picked = mode === "studio" ? actors.find((actor) => actor.id === selected) : undefined;
  const pickedAgent = agents.find((item) => item.agent.id === picked?.id);
  // An emote is acted out by the person's own figure while they walk, else by the agent they
  // picked, else by the whole team.
  const emoteFor = walking
    ? "You"
    : pickedAgent
      ? (names.get(pickedAgent.agent.id) ?? pickedAgent.agent.name)
      : "Everyone";
  /** Picks up an agent's waiting result: it leaves the desk, and the agent cheers. */
  const collect = useCallback(
    (agentId: string) => {
      const result = results.get(agentId);
      if (!result) return;
      useStudioResults.getState().collect(result.runId);
      useStudioOrders.getState().give(agentId, { emote: "cheer", emotedAt: Date.now() });
    },
    [results],
  );
  const collectRef = useRef(collect);
  collectRef.current = collect;
  /** Opens an agent's panel on what it is waiting with: its result, from its desk's sign. */
  const seeResult = useCallback(
    (agentId: string) => {
      setSelected(agentId);
      setFocus((known) => known + 1);
    },
    [setSelected],
  );
  const act = useCallback(
    (kind: StudioEmote) => {
      setEmoteOpen(false);
      if (walking) return setMyEmote({ kind, at: Date.now() });
      const store = useStudioOrders.getState();
      for (const id of pickedAgent ? [pickedAgent.agent.id] : ownIds)
        store.give(id, { emote: kind, emotedAt: Date.now() });
    },
    [walking, pickedAgent, ownIds],
  );
  const levels = useMemo(
    () => new Map([...records].map(([id, record]) => [id, record.level])),
    [records],
  );
  // A "+1" rises off an agent as a task of its finishes while the studio is watched.
  const [pops, setPops] = useState<Record<string, number>>({});
  const lastDone = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const now = new Map(
      agents.filter((item) => item.outcome === "done").map((item) => [item.agent.id, item.endedAt]),
    );
    const before = lastDone.current;
    lastDone.current = now;
    if (!before) return;
    const fresh = [...now].filter(([id, ended]) => before.get(id) !== ended).map(([id]) => id);
    if (!fresh.length) return;
    const at = Date.now();
    setPops((known) => ({ ...known, ...Object.fromEntries(fresh.map((id) => [id, at])) }));
    const timer = window.setTimeout(
      () =>
        setPops((known) =>
          Object.fromEntries(Object.entries(known).filter(([, when]) => when !== at)),
        ),
      POP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [agents]);
  // The walking controls show for a while each time walking starts, then get out of the way.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!walking) return setHint(false);
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [walking]);
  const nearDesk = near?.startsWith("desk:") ? near.slice(5) : "";
  const nearArcade = Boolean(near?.startsWith("arcade:"));
  const nearResult = near?.startsWith("result:") ? near.slice(7) : "";
  const nearName = nearDesk
    ? "Hire here"
    : nearArcade
      ? "Play games"
      : nearResult
        ? "See result"
        : near
          ? `Talk to ${names.get(near) ?? actors.find((actor) => actor.id === near)?.name ?? ""}`
          : "";
  // A member picked from the room or the team panel, here or not (a request's sender may not be).
  const pickedMember = selected?.startsWith("member:") ? memberOf(selected, people) : undefined;
  const switchMode = useCallback(
    (next: StudioMode, deskId?: string) => {
      setMode(next);
      setPickedItem(null);
      setHireDesk(next === "hire" ? deskId : undefined);
      if (next !== "studio") setSelected(null);
    },
    [setSelected],
  );

  // 1 to 3 are the hotbar's, H and B pick a mode and Esc goes back, N shows or hides name tags.
  // The handler reads the latest state through a ref, so it is added once.
  const keyState = useRef({
    building,
    switchMode,
    openGames,
    emoteOpen,
    act,
    toggleMusic,
    fullscreen,
    hotbar: false,
    attending: false,
    release: () => {},
  });
  keyState.current = {
    building,
    switchMode,
    openGames,
    emoteOpen,
    act,
    toggleMusic,
    fullscreen,
    hotbar: mode === "studio" && !loading && agents.length > 0,
    attending: Boolean(selected),
    release: () => setSelected(null),
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (typingIn(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const known = keyState.current;
      // While the emote picker is open its number keys pick an emote, and Escape closes it.
      if (known.emoteOpen) {
        const index = Number(event.code.replace("Digit", "")) - 1;
        const chosen = event.code.startsWith("Digit") ? emotes[index] : undefined;
        if (chosen || event.code === "Escape") {
          event.preventDefault();
          if (chosen) known.act(chosen.emote);
          else setEmoteOpen(false);
          return;
        }
      }
      if (known.hotbar && event.code === EMOTE_KEY) {
        event.preventDefault();
        setEmoteOpen((open) => !open);
        return;
      }
      if (event.code === LEVEL_KEY) {
        event.preventDefault();
        const card = useLevelCardShown.getState();
        card.set({ shown: !card.value.shown });
        return;
      }
      if (event.code === "KeyN") {
        event.preventDefault();
        const names = useStudioNames.getState();
        names.set({ shown: !names.value.shown });
        return;
      }
      if (known.hotbar && event.code === MUSIC_KEY) {
        event.preventDefault();
        known.toggleMusic();
        return;
      }
      if (event.code === "KeyF") {
        event.preventDefault();
        setFullscreen((on) => !on);
        return;
      }
      // Escape lets go of whoever has the person's attention first.
      if (event.code === "Escape" && known.attending) {
        event.preventDefault();
        known.release();
        return;
      }
      if (event.code === "Escape" && known.fullscreen) {
        event.preventDefault();
        setFullscreen(false);
        return;
      }
      if (known.hotbar && event.code === GAMES_KEY) {
        event.preventDefault();
        known.openGames();
        return;
      }
      const next = modeForKey(event.code);
      if (next) {
        event.preventDefault();
        keyState.current.switchMode(next);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  // Walked up to an agent, E gets its attention: what is said or typed goes to it. At a free
  // desk, E hires someone for it.
  useEffect(() => {
    if (!walking || !near) return;
    const talk = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || typingIn(event.target) || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (near.startsWith("desk:")) {
        switchMode("hire", near.slice(5));
        return;
      }
      if (near.startsWith("arcade:")) {
        setArcadeOpen(true);
        return;
      }
      if (near.startsWith("result:")) {
        // Picks up what it left on its desk, and has its attention.
        collectRef.current(near.slice(7));
        setSelected(near.slice(7));
        return;
      }
      setSelected(near);
      setFocus((known) => known + 1);
    };
    window.addEventListener("keydown", talk);
    return () => window.removeEventListener("keydown", talk);
  }, [walking, near, switchMode, setSelected]);

  return (
    <Surface
      tone="stage"
      className={cn(
        // The room is in colour, which the owner allowed for this one surface; everything laid
        // over it floats on see-through panels.
        "group/studio relative h-full min-h-0 overflow-hidden",
        // Full screen, it covers the rest of Misty: the sidebar, the bars and the window's chrome.
        fullscreen && "fixed inset-0 z-[var(--stack-pane-top)] h-auto",
        "[&_canvas]:block [&_canvas]:touch-none",
        building && "[&_canvas]:cursor-default",
      )}
      data-misty-window-drag-block="true"
      data-building={building || undefined}
      data-talking={(picked && !pickedAgent) || pickedMember ? true : undefined}
    >
      {!drawable ? (
        <ErrorState
          title="Couldn't draw the studio"
          line="This computer's graphics don't support drawing the room."
        />
      ) : (
        <SceneBoundary onRetry={() => setSceneKey((known) => known + 1)}>
          <Suspense fallback={<StudioSkeleton />}>
            {loading || !layout ? (
              <StudioSkeleton />
            ) : (
              <StudioScene
                key={sceneKey}
                actors={actors}
                layout={layout}
                selected={selected}
                onSelect={setSelected}
                listening={picked?.id ?? null}
                myEmote={myEmote}
                trophies={progress.reached.length}
                onArcade={() => setArcadeOpen(true)}
                namesShown={namesShown}
                pops={pops}
                prompt={
                  walking && near && nearName && selected !== (nearResult || near)
                    ? {
                        anchor:
                          near.startsWith("desk:") ||
                          near.startsWith("arcade:") ||
                          near.startsWith("result:")
                            ? near
                            : `head:${near}`,
                        words: nearName,
                      }
                    : null
                }
                results={resultIds}
                onCollect={seeResult}
                onFirstPerson={setFirstPerson}
                // Talking keeps the camera free: the box takes keys, not the cursor.
                freeLook={mode === "studio" && !customizing && !arcadeOpen}
                building={building}
                pickedItem={pickedItem}
                onPickItem={setPickedItem}
                onLayout={change}
                walking={walking}
                names={names}
                speech={speech}
                onNear={setNear}
                onHireAt={(deskId) => switchMode("hire", deskId)}
                board={board}
                looks={looks}
              />
            )}
          </Suspense>
        </SceneBoundary>
      )}
      {mode === "studio" && customizingAgent ? (
        <CustomizePanel
          key={customizingAgent.id}
          agent={customizingAgent}
          deskId={layout ? deskOwners(layout.items, ownIds).get(customizingAgent.id) : undefined}
          onClose={() => setCustomizing(null)}
        />
      ) : mode === "studio" && teamOpen ? (
        <TeamPanel
          onClose={() => setTeamOpen(false)}
          levels={levels}
          agents={agents}
          visitors={teammates}
          people={people.members}
          requests={people.requests}
          onHire={() => switchMode("hire")}
          outcomes={outcomes}
          names={names}
          selected={selected}
          loading={loading}
          onPick={(id) => {
            setSelected(id);
            setFocus((known) => known + 1);
            setTeamOpen(false);
          }}
        />
      ) : null}
      {mode === "hire" ? (
        <HirePanel
          key={hireDesk ?? ""}
          deskId={hireDesk}
          onClose={() => switchMode("studio")}
          onHired={(agent, deskId) => {
            if (deskId && layout) change(assignDesk(layout, deskId, agent.id));
            switchMode("studio");
            setSelected(agent.id);
          }}
        />
      ) : null}
      {building && layout ? (
        <BuildPanel
          layout={layout}
          progress={progress}
          agents={agents}
          picked={pickedItem}
          onPick={setPickedItem}
          onLayout={change}
          onClose={() => switchMode("studio")}
          onReset={() => {
            reset();
            setPickedItem(null);
          }}
        />
      ) : null}
      {mode === "studio" && musicShown && !arcadeOpen ? <MusicPanel /> : null}
      {walking && firstPerson && !loading && !arcadeOpen ? <SceneCrosshair /> : null}
      {hint && !picked && !musicShown ? (
        <Surface tone="scene-panel" radius="lg" className={hintClass} aria-hidden="true">
          <Text bare as="div" size="meta" tone="bright" className="flex items-center gap-2">
            <Kbd strong>WASD</Kbd>
            <span>Move</span>
            <Kbd strong>Space</Kbd>
            <span>Jump</span>
            <Text bare tone="muted">
              Click to look, Esc to stop, scroll to step {firstPerson ? "back" : "in"}
            </Text>
            <Kbd strong>E</Kbd>
            <span>Get attention</span>
            <Kbd strong>V</Kbd>
            <span>Hold to talk</span>
          </Text>
        </Surface>
      ) : null}
      {mode === "studio" && pickedMember && people.spaceId ? (
        <MemberTalk
          key={pickedMember.userId}
          spaceId={people.spaceId}
          member={pickedMember}
          focus={focus}
          onClose={() => setSelected(null)}
        />
      ) : picked && picked.kind !== "member" && !pickedAgent ? (
        // A visiting agent is asked through its person, in a panel of its own; the person's own
        // agents are talked to in the chat at the bottom left.
        <AgentTalk
          key={picked.id}
          actor={picked}
          name={names.get(picked.id) ?? picked.name}
          item={pickedAgent}
          focus={focus}
          onOpenChat={props.onOpenChat}
          onCustomize={pickedAgent ? () => setCustomizing(pickedAgent.agent.id) : undefined}
          onSettings={pickedAgent ? () => props.onAgentSettings(pickedAgent.agent.id) : undefined}
          onClose={() => setSelected(null)}
          record={pickedAgent ? records.get(pickedAgent.agent.id) : undefined}
          result={pickedAgent ? results.get(pickedAgent.agent.id) : undefined}
          onCollect={pickedAgent ? () => collect(pickedAgent.agent.id) : undefined}
        />
      ) : null}
      {mode === "studio" && !arcadeOpen ? (
        <StudioTopBar
          teamCount={loading ? null : agents.length}
          teamOpen={teamOpen && !customizingAgent}
          onTeam={() => {
            setCustomizing(null);
            setTeamOpen((open) => !open);
          }}
          attention={
            pickedAgent && picked
              ? {
                  id: pickedAgent.agent.id,
                  name: names.get(pickedAgent.agent.id) ?? pickedAgent.agent.name,
                  state: pickedAgent.state,
                  agent: pickedAgent.agent,
                  following: picked.order === "person",
                }
              : null
          }
          onCustomize={() => pickedAgent && setCustomizing(pickedAgent.agent.id)}
          onSettings={() => pickedAgent && props.onAgentSettings(pickedAgent.agent.id)}
          onSendBack={() => pickedAgent && useStudioOrders.getState().release(pickedAgent.agent.id)}
          onRelease={() => setSelected(null)}
          level={progress.reached.length + 1}
          trophies={progress.reached.length}
          levelOpen={levelCardShown}
          onLevel={() => useLevelCardShown.getState().set({ shown: !levelCardShown })}
        />
      ) : null}
      {mode === "studio" &&
      levelCardShown &&
      !loading &&
      !(picked && !pickedAgent) &&
      !pickedMember &&
      !arcadeOpen ? (
        <LevelCard progress={progress} tally={tally} quests={quests} />
      ) : null}
      {unlocked && !arcadeOpen ? (
        <UnlockBanner
          unlock={unlocked}
          onBuild={() => {
            setUnlocked(null);
            switchMode("build");
          }}
          onClose={() => setUnlocked(null)}
        />
      ) : null}
      {mode === "studio" && !loading && agents.length && !arcadeOpen ? (
        <StudioHotbar
          onGames={openGames}
          emoteOpen={emoteOpen}
          onEmoteOpen={setEmoteOpen}
          music={musicShown}
          onMusic={toggleMusic}
          onBuild={() => switchMode("build")}
          progress={progress}
          names={namesShown}
          onNames={(shown) => useStudioNames.getState().set({ shown })}
        />
      ) : null}
      {emoteOpen && mode === "studio" && !arcadeOpen ? (
        <EmotePicker who={emoteFor} onEmote={act} onClose={() => setEmoteOpen(false)} />
      ) : null}
      {arcadeOpen ? <ArcadePanel spaceId={spaceKey} onClose={() => setArcadeOpen(false)} /> : null}
      {mode === "studio" && !loading && agents.length && !arcadeOpen ? (
        <Surface tone="scene-panel" radius="xl" className={chatBarClass} data-tour="studio-ask">
          <StudioBox
            agents={agents}
            names={names}
            visitors={teammates}
            attention={pickedAgent ?? null}
            onTalking={setSelected}
          />
        </Surface>
      ) : null}
    </Surface>
  );
}

/** The warning an agent's tag and panel show when a teammate's agent is changing its file too. */
function clashLine(files: string[], teammates: readonly TeammateAgent[]) {
  const clash = claimedByOthers(files, teammates)[0];
  return clash ? `${clash.by.owner}'s ${clash.by.name} is on ${fileName(clash.file)}` : "";
}

/** A picked member, from who is in the Space now or, failing that, a request they sent. */
function memberOf(id: string, people: ReturnType<typeof useStudioPeople>) {
  const userId = id.slice("member:".length);
  const member = people.members.find((candidate) => candidate.userId === userId);
  if (member) return { ...member, where: placeWords(member) };
  const request = people.requests.find((candidate) => candidate.fromUserId === userId);
  // Not in the Space right now: there is nowhere to say they are.
  return request ? { userId, name: request.fromName, where: "" } : undefined;
}
