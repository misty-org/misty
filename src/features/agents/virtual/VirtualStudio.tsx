import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/shared/ui";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { currentSpaceKey } from "../engines/enginesApi";
import { listenForActionQuestions, useActionQuestions } from "../island/actionQuestions";
import { AgentTalk } from "./AgentTalk";
import { BuildPanel } from "./BuildPanel";
import { HirePanel } from "./HireAgent";
import { modeForKey, StudioDock, TeamPanel, type StudioMode } from "./StudioHud";
import { CustomizePanel } from "./CustomizePanel";
import { assignDesk, deskOwners } from "./studio/layout";
import { useStudioLooks } from "./studioLooks";
import type { Actor } from "./studio/behaviour";
import { useStudioLayout } from "./studio/layoutStore";
import { StudioBox } from "./StudioBox";
import { studioNames } from "./studioNames";
import { boardOf, huddledAgents, useStudioSpeech, useStudioTalk } from "./studioTalk";
import { setStudioSounds, useStudioCues, useStudioSoundsOn } from "./studioSounds";
import { useSteadyStates } from "./steady";
import { useTeammateAgents } from "./teammates";
import { useStudioAgents, type StudioAgent } from "./useStudioAgents";
import "./virtualStudio.css";

const StudioScene = lazy(() => import("./studio/StudioScene"));

/** How long a finished or failed run stays marked when the person hasn't looked at its agent. */
const OUTCOME_MS = 30 * 60_000;

/** The shape of the studio while it loads: the room, the row of agents and the build button. */
function StudioSkeleton() {
  return (
    <div className="virtual-studio-loading" aria-hidden="true">
      <Skeleton className="virtual-studio-loading-room" />
    </div>
  );
}

const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The Space's agents as a studio to look into and talk in: each has a desk and types at it while
 * it works, comes to the door and waves when it needs its person, and drifts around the lounge when
 * it has nothing to do. Picking a figure, or walking up to it, opens a panel to talk to it and
 * answer what it asks; the box along the bottom takes a message for any of them, or a task for
 * several together. Teammates' agents drop by as visitors. Build mode rearranges the furniture,
 * which is kept per Space on this computer. It only shows what the runs report.
 */
export function VirtualStudio(props: {
  onOpenChat(agentId: string, conversationId: string): void;
}) {
  const { agents: everyone, loading: agentsLoading } = useStudioAgents();
  // Misty's own built-in agent isn't one of the team: the studio is for the person's engines.
  const reported = useMemo(() => everyone.filter((item) => !item.agent.system_managed), [everyone]);
  const teammates = useTeammateAgents((state) => state.agents);
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
  const [walking, setWalking] = useState(false);
  const [near, setNear] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  /** The agent being dressed up in the Customize panel, if any. */
  const [customizing, setCustomizing] = useState<string | null>(null);
  const looks = useStudioLooks((state) => state.looks);
  useEffect(() => void useStudioLooks.getState().load(), []);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  /** The free desk Hire was opened for, if any. */
  const [hireDesk, setHireDesk] = useState<string | undefined>();
  const building = mode === "build";

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
  const huddled = useMemo(() => huddledAgents(huddles, conversations), [huddles, conversations]);
  const speech = useStudioSpeech(chats);
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
      ...agents.map(({ agent, state, doing, doingCode, task }) => ({
        id: agent.id,
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
      })),
      ...teammates.map((mate) => ({
        id: `guest:${mate.key}`,
        name: mate.name,
        owner: mate.owner,
        guest: true,
        state: mate.state,
        doing: mate.doing,
        doingCode: "",
      })),
    ],
    [agents, teammates, huddled, outcomes],
  );
  const soundsOn = useStudioSoundsOn();
  useStudioCues(
    soundsOn,
    useMemo(() => actors.filter((actor) => !actor.guest), [actors]),
  );
  const ownIds = useMemo(() => agents.map((item) => item.agent.id), [agents]);
  const customizingAgent = agents.find((item) => item.agent.id === customizing)?.agent ?? undefined;
  const picked = mode === "studio" ? actors.find((actor) => actor.id === selected) : undefined;
  const pickedAgent = agents.find((item) => item.agent.id === picked?.id);
  const nearDesk = near?.startsWith("desk:") ? near.slice(5) : "";
  const nearName = nearDesk ? "Hire here" : near ? `Talk to ${names.get(near) ?? ""}` : "";
  const switchMode = useCallback(
    (next: StudioMode, deskId?: string) => {
      setMode(next);
      setPickedItem(null);
      setHireDesk(next === "hire" ? deskId : undefined);
      // Building is done from above, the whole room in view.
      if (next === "build") setWalking(false);
      if (next !== "studio") setSelected(null);
    },
    [setSelected],
  );

  // 1, 2 and 3 pick a mode; V switches between looking over the room and walking in it.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (typingIn(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const next = modeForKey(event.code);
      if (next) {
        event.preventDefault();
        switchMode(next);
      } else if (event.code === "KeyV" && !building) {
        event.preventDefault();
        setWalking((known) => !known);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  // Walked up to an agent, E opens the talk panel with the cursor in its box; at a free desk, E
  // hires someone for it.
  useEffect(() => {
    if (!walking || !near) return;
    const talk = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || typingIn(event.target) || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (near.startsWith("desk:")) {
        switchMode("hire", near.slice(5));
        return;
      }
      setSelected(near);
      setFocus((known) => known + 1);
    };
    window.addEventListener("keydown", talk);
    return () => window.removeEventListener("keydown", talk);
  }, [walking, near, switchMode, setSelected]);

  return (
    <div
      className="virtual-studio"
      data-misty-window-drag-block="true"
      data-building={building || undefined}
      data-talking={picked ? true : undefined}
    >
      <Suspense fallback={<StudioSkeleton />}>
        {loading || !layout ? (
          <StudioSkeleton />
        ) : (
          <StudioScene
            actors={actors}
            layout={layout}
            selected={selected}
            onSelect={setSelected}
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
            footsteps={soundsOn}
          />
        )}
      </Suspense>
      {mode === "studio" && customizingAgent ? (
        <CustomizePanel
          key={customizingAgent.id}
          agent={customizingAgent}
          deskId={layout ? deskOwners(layout.items, ownIds).get(customizingAgent.id) : undefined}
          onClose={() => setCustomizing(null)}
        />
      ) : mode === "studio" && !walking ? (
        <TeamPanel
          agents={agents}
          outcomes={outcomes}
          names={names}
          selected={selected}
          loading={loading}
          onPick={(id) => {
            setSelected(id);
            setFocus((known) => known + 1);
          }}
        />
      ) : null}
      {mode === "hire" ? (
        <HirePanel
          key={hireDesk ?? ""}
          deskId={hireDesk}
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
          agents={agents}
          picked={pickedItem}
          onPick={setPickedItem}
          onLayout={change}
          onReset={() => {
            reset();
            setPickedItem(null);
          }}
        />
      ) : null}
      {walking && nearName && selected !== near ? (
        <div className="virtual-studio-near" role="status">
          <kbd>E</kbd>
          <span className="truncate">{nearName}</span>
        </div>
      ) : walking && !picked ? (
        <div className="virtual-studio-near" aria-hidden="true">
          <kbd>WASD</kbd>
          <span>Move</span>
          <kbd>Space</kbd>
          <span>Jump</span>
          <span className="text-cream-muted">Drag to look</span>
          <kbd>V</kbd>
          <span>Overview</span>
        </div>
      ) : null}
      {picked ? (
        <AgentTalk
          key={picked.id}
          actor={picked}
          name={names.get(picked.id) ?? picked.name}
          item={pickedAgent}
          focus={focus}
          onOpenChat={props.onOpenChat}
          onCustomize={pickedAgent ? () => setCustomizing(pickedAgent.agent.id) : undefined}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <StudioDock
        mode={mode}
        onMode={(next) => switchMode(next)}
        walking={walking}
        sounds={soundsOn}
        onSounds={setStudioSounds}
        onWalking={(next) => {
          if (building) switchMode("studio");
          setWalking(next);
        }}
      >
        {mode === "studio" && !loading && agents.length ? (
          <StudioBox agents={agents} names={names} onTalking={setSelected} />
        ) : null}
      </StudioDock>
    </div>
  );
}
