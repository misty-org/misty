import { Eye, Hand, Square } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { Button, OverflowFadeText, Surface, Text } from "@/shared/ui";
import { useContextPanel } from "../context-panel/contextPanelStore";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { AgentAvatar } from "../personal/AgentAvatar";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { aiSurfaceApi } from "../runs/invocations/api";
import { readRunState } from "../runs/invocations/invocationSubscription";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { RunRow, RunStep } from "./activityApi";
import { RunStateBadge } from "./RunLabels";
import { StepPicture } from "./RunSteps";
import { describeLive, lastPage, verbOf } from "./stepSentences";
import { useRunSteps } from "./useRunSteps";
import { useNow } from "@/shared/hooks/useNow";

/** A run with no step for this long may be thinking, or done: its card stops saying it's busy. */
const IDLE_AFTER_MS = 60_000;
/** A run whose row hasn't moved in this long without the runtime knowing it isn't going on. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const ongoing = (run: RunRow, now: number) =>
  (run.state === "running" || run.state === "needs-you") && now - run.updatedAt < STALE_AFTER_MS;

/**
 * The ledger's runs that the runtime says are still going on. A run cut short by Misty quitting
 * stays "running" in the ledger; the runtime knows better.
 */
function useLiveRuns(runs: RunRow[] | null): RunRow[] {
  const now = useNow();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const candidates = useMemo(() => (runs ?? []).filter((run) => ongoing(run, now)), [runs, now]);
  const key = candidates.map((run) => run.runId).join("\n");
  useEffect(() => {
    if (!hasTauriInternals() || !key) return;
    let live = true;
    void Promise.all(
      key.split("\n").map(async (runId) => {
        const state = await readRunState(runId).catch(() => "running");
        return state === "running" ? "" : runId;
      }),
    ).then((ended) => {
      if (live) setGone(new Set(ended.filter(Boolean)));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return candidates.filter((run) => !gone.has(run.runId));
}

/** How long a run has gone on, ticking each second. */
function Elapsed({ since }: { since: number }) {
  const now = useNow("second");
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  const text =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
      : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Text bare size="caption" tone="muted" className="shrink-0 tabular-nums">
      {text}
    </Text>
  );
}

interface OpenChatRequest {
  agentId: string | undefined;
  conversationId: string;
}

/**
 * What the person's agents are doing right now in this Space: one card per run going on, with
 * a picture of the page it is on, what it is doing in a few words, how long it has run, and Watch,
 * Help now and Stop. A run that waits for its person comes first. Nothing shows while all rest.
 */
export function HappeningNow(props: {
  runs: RunRow[] | null;
  chats: GlobalAiConversation[];
  heading?: ReactNode;
  folder?: string;
  className?: string;
  onOpenChat(request: OpenChatRequest): void;
}) {
  const live = useLiveRuns(props.runs);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const steps = useRunSteps(live.map((run) => run.runId));
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const now = useNow();
  if (!live.length) return null;
  const sorted = [...live].sort(
    (a, b) =>
      Number(b.state === "needs-you") - Number(a.state === "needs-you") ||
      b.startedAt - a.startedAt,
  );
  const chatOf = (id: string) => props.chats.find((chat) => chat.id === id);
  const agentOf = (agentId?: string): AgentProfile | undefined =>
    agents.find((agent) => agent.id === agentId) ??
    (agentId ? undefined : agents.find((agent) => agent.system_managed));

  const open = (run: RunRow) => {
    useContextPanel.getState().show("steps");
    props.onOpenChat({
      agentId: chatOf(run.conversationId)?.agentId,
      conversationId: run.conversationId,
    });
  };
  const stop = async (run: RunRow) => {
    setStopping((current) => new Set(current).add(run.runId));
    await aiSurfaceApi.cancelInvocation(run.runId).catch(() => undefined);
  };

  return (
    <section className={props.className} aria-label="Happening now">
      {props.heading}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {sorted.map((run) => {
          const runSteps: RunStep[] = steps?.[run.runId] ?? [];
          const latest = runSteps[runSteps.length - 1];
          const picture = [...runSteps].reverse().find((step) => step.picture)?.picture ?? "";
          const waiting =
            run.state === "needs-you" ||
            (latest?.state === "running" && verbOf(latest.tool) === "ask");
          const idle =
            !waiting &&
            latest?.state !== "running" &&
            now - (latest?.at ?? run.startedAt) > IDLE_AFTER_MS;
          const chat = chatOf(run.conversationId);
          const agent = agentOf(chat?.agentId);
          const line = waiting
            ? "Waiting for you"
            : idle
              ? "No step for a minute"
              : describeLive(latest, { folder: props.folder, page: lastPage(runSteps) });
          return (
            <Surface
              as="article"
              key={run.runId}
              tone="card"
              edge="hairline"
              radius="xl"
              state={waiting ? "waiting" : idle ? undefined : "working"}
              className="flex min-w-0 flex-col gap-2.5 p-2.5 motion-safe:transition-[background-color,border-color] motion-safe:duration-160"
              data-state={waiting ? "needs-you" : idle ? "idle" : "running"}
            >
              <Surface tone="well" radius="lg" className="relative aspect-video overflow-hidden">
                {picture ? (
                  <StepPicture runId={run.runId} picture={picture} fill />
                ) : (
                  <span className="grid h-full place-items-center" aria-hidden="true">
                    <AgentAvatar agent={agent} large />
                  </span>
                )}
                <Surface
                  as="span"
                  tone="card"
                  radius="md"
                  className="absolute top-2 left-2 px-2 py-0.5 shadow-sm"
                >
                  <RunStateBadge
                    state={waiting ? "needs-you" : idle ? "idle" : "running"}
                    tone="default"
                  />
                </Surface>
              </Surface>
              <div className="grid min-w-0 gap-1 px-1 pb-0.5">
                <Text as="h3" size="control" weight="semibold" tone="bright">
                  {chat?.title?.trim() || "New chat"}
                </Text>
                <Text
                  as="p"
                  bare
                  size="meta"
                  tone="default"
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <OverflowFadeText full>{line}</OverflowFadeText>
                  <Elapsed since={run.startedAt} />
                </Text>
                <Text
                  as="p"
                  bare
                  size="caption"
                  tone="muted"
                  className="flex min-w-0 items-center gap-1.5 [&_.agent-avatar]:size-4.5!"
                >
                  <AgentAvatar agent={agent} compact />
                  <OverflowFadeText full>{agent?.name ?? "Agent"}</OverflowFadeText>
                </Text>
                <div className="flex gap-1.5 pt-1.5">
                  {waiting ? (
                    <Button onClick={() => open(run)}>
                      <Hand aria-hidden="true" />
                      Help now
                    </Button>
                  ) : (
                    <Button onClick={() => open(run)}>
                      <Eye aria-hidden="true" />
                      Watch
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    disabled={stopping.has(run.runId)}
                    onClick={() => void stop(run)}
                  >
                    <Square aria-hidden="true" />
                    {stopping.has(run.runId) ? "Stopping" : "Stop"}
                  </Button>
                </div>
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}
