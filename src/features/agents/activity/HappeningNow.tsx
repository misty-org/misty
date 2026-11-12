import { Eye, Hand, Square } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentProfile } from "@/shared/schemas";
import { Button, OverflowFadeText } from "@/shared/ui";
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
import { describeLive, lastPage, toolKey, verbOf } from "./stepSentences";
import { useRunSteps } from "./useRunSteps";
import "./activity.css";

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
  const [now, setNow] = useState(() => Date.now());
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  const text =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
      : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return <span className="activity-muted tabular-nums">{text}</span>;
}

export interface OpenChatRequest {
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
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

  const open = (run: RunRow, panel: "browser" | "steps") => {
    useContextPanel.getState().show(panel);
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
      <div className="activity-now">
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
          const onBrowser = latest ? toolKey(latest.tool).startsWith("browser.") : false;
          const chat = chatOf(run.conversationId);
          const agent = agentOf(chat?.agentId);
          const line = waiting
            ? "Waiting for you"
            : idle
              ? "No step for a minute"
              : describeLive(latest, { folder: props.folder, page: lastPage(runSteps) });
          return (
            <article
              key={run.runId}
              className="activity-now-card"
              data-state={waiting ? "needs-you" : idle ? "idle" : "running"}
            >
              <div className="activity-now-frame">
                {picture ? (
                  <StepPicture
                    runId={run.runId}
                    picture={picture}
                    className="activity-now-picture"
                  />
                ) : (
                  <span className="activity-now-blank" aria-hidden="true">
                    <AgentAvatar agent={agent} large />
                  </span>
                )}
                <span className="activity-now-badge">
                  <RunStateBadge state={waiting ? "needs-you" : idle ? "idle" : "running"} />
                </span>
              </div>
              <div className="activity-now-body">
                <h3 className="activity-now-title">{chat?.title?.trim() || "New chat"}</h3>
                <p className="activity-now-line">
                  <OverflowFadeText full>{line}</OverflowFadeText>
                  <Elapsed since={run.startedAt} />
                </p>
                <p className="activity-now-agent">
                  <AgentAvatar agent={agent} compact />
                  <OverflowFadeText full>{agent?.name ?? "Agent"}</OverflowFadeText>
                </p>
                <div className="activity-now-actions">
                  {waiting ? (
                    <Button onClick={() => open(run, onBrowser ? "browser" : "steps")}>
                      <Hand aria-hidden="true" />
                      Help now
                    </Button>
                  ) : (
                    <Button onClick={() => open(run, onBrowser ? "browser" : "steps")}>
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
            </article>
          );
        })}
      </div>
    </section>
  );
}
