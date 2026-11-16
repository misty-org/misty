import { newLocalConversation } from "../conversations/state/localConversation";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { readRunState } from "../runs/invocations/invocationSubscription";
import { useCollaborationStore } from "../plans/store";
import { makeOverviewAudio, makeVideoAudio } from "./tutorAudio";
import { parseDeck, parseMarkdown, parseOverview, parseQuiz } from "./tutorPrompts";
import { agentTag } from "./agentTag";
import { addLink } from "./tutorSources";
import {
  briefKey,
  parseBrief,
  parseInfographic,
  parseMindmap,
  parseResearch,
  parseVideo,
  slidesOf,
} from "./tutorStudio";
import { useTutorStore } from "./tutorStore";
import type { TutorJob, TutorJobKind } from "./tutorTypes";
import { defaultEngineAgent } from "../engines/defaultEngine";
import {
  defaultEngineId,
  followEngineRun,
  noDefaultEngine,
  runOnEngine,
  stopEngineRun,
  type EngineRunResult,
} from "../engines/engineRun";

/** Why a run failed when it answered with nothing Misty could read into what it was making. */
export const unusableReply = "The reply had nothing Misty could use.";

/**
 * The Lab's runs. A job (a guide, deck, quiz, overview, sources found) runs on the default engine
 * with no agent chat behind it and is read into what it makes when its answer is in (`startJob`).
 * `startRun` is an ordinary agent chat turn, kept for what is a chat (a pick-up's draft).
 */

type Started = { conversationId: string; started: boolean; error?: string };

/** Starts `prompt` in a new chat with `agentId`. Not started while another turn is working. */
export async function startRun(input: {
  agentId: string;
  title: string;
  prompt: string;
  /** Teach makes it a lesson; nobody watches a background run, so it doesn't stop to ask. */
  mode: "act" | "teach";
  background: boolean;
  /** Leaves what the person has open alone, without the background's Auto. */
  stay?: boolean;
  conversationId?: string;
}): Promise<Started> {
  const store = useMistyStore.getState();
  let conversationId = input.conversationId;
  if (!conversationId) {
    const conversation = newLocalConversation(input.title, undefined, input.agentId);
    useMistyStore.setState((state) => ({
      conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)],
    }));
    conversationId = conversation.id;
    if (input.mode === "teach")
      await useCollaborationStore
        .getState()
        .setMode(conversationId, "teach")
        .catch(() => undefined);
  }
  // A turn sent now would be steered into the one already working.
  if (store.working) return { conversationId, started: false };
  const before = { agent: store.selectedAgentId, active: store.activeConversationId };
  useMistyStore.setState({ selectedAgentId: input.agentId });
  try {
    await useMistyStore.getState().submitAnswer(
      input.prompt,
      [],
      undefined,
      [],
      { conversationId, context: [] },
      {
        // An ordinary chat turn: "agent" would hand the engine the desktop with its own cursor,
        // which nothing in Tutor needs.
        executionMode: "user",
        idempotencyKey: `tutor:${conversationId}:${Date.now()}`,
        collaborationMode: input.mode,
        ...(input.background ? { permissionMode: "auto" as const } : {}),
      },
    );
  } catch (error) {
    return {
      conversationId,
      started: false,
      error: error instanceof Error ? error.message : "Misty could not start this run.",
    };
  } finally {
    if (input.background || input.stay)
      useMistyStore.setState({
        selectedAgentId: before.agent,
        activeConversationId: before.active,
      });
  }
  const after = useMistyStore.getState();
  const started = after.invocationConversationId === conversationId && Boolean(after.invocationId);
  return { conversationId, started, error: started ? undefined : (after.error ?? undefined) };
}

/**
 * Starts a run that makes something for the Lab, on the default engine. It's Misty's own work, so
 * there's no agent chat behind it, and runs go side by side.
 */
export async function startJob(input: {
  kind: TutorJobKind;
  title: string;
  /** Kept for callers from before the default engine; the default engine runs every job. */
  agentId?: string;
  prompt: string;
  notebookId?: string;
  sourceId?: string;
  transformation?: string;
  report?: string;
}): Promise<TutorJob> {
  const now = new Date().toISOString();
  const engineId = await defaultEngineId().catch(() => "");
  const job: TutorJob = {
    ...input,
    agentId: (engineId && defaultEngineAgent(engineId)) || engineId,
    id: `job-${crypto.randomUUID()}`,
    state: engineId ? "running" : "failed",
    ...(engineId ? {} : { error: noDefaultEngine }),
    createdAt: now,
    updatedAt: now,
  };
  useTutorStore.getState().saveJob(job);
  if (engineId) void run(job);
  return job;
}

/** Jobs being followed now, so a restart or a second window doesn't follow one twice. */
const following = new Set<string>();

/** The Space a job's notebook lives in, for the engine's Space tools. */
const spaceOf = (job: TutorJob) =>
  job.notebookId ? useTutorStore.getState().notebooks[job.notebookId]?.space?.spaceId : undefined;

/** Runs the job on the default engine and reads its answer into what it makes. */
async function run(job: TutorJob, existingRun?: string): Promise<void> {
  if (following.has(job.id)) return;
  following.add(job.id);
  try {
    const result = existingRun
      ? await followEngineRun(existingRun)
      : await runOnEngine({
          prompt: job.prompt,
          key: `${job.id}:${job.restarts ?? 0}`,
          spaceId: spaceOf(job),
          onStarted: (runId) => {
            const current = useTutorStore.getState().jobs[job.id];
            if (current) useTutorStore.getState().saveJob({ ...current, runId });
          },
        });
    finish(job.id, result);
  } catch (reason) {
    finish(job.id, {
      runId: "",
      text: "",
      error: reason instanceof Error ? reason.message : String(reason),
    });
  } finally {
    following.delete(job.id);
  }
}

function finish(jobId: string, result: EngineRunResult) {
  const current = useTutorStore.getState().jobs[jobId];
  // Dismissed meanwhile, or already read.
  if (!current || current.state !== "running") return;
  const now = new Date().toISOString();
  if (result.error && !result.text.trim()) {
    useTutorStore
      .getState()
      .saveJob({ ...current, state: "failed", error: result.error, updatedAt: now });
    return;
  }
  const resultId = settle(current, result.text);
  useTutorStore
    .getState()
    .saveJob(
      resultId
        ? { ...current, state: "done", error: undefined, resultId, updatedAt: now }
        : { ...current, state: "failed", error: result.error || unusableReply, updatedAt: now },
    );
}

/** Stops a job and drops it. */
export async function dismissJob(job: TutorJob): Promise<void> {
  if (job.state === "running" && job.runId) await stopEngineRun(job.runId);
  useTutorStore.getState().removeJob(job.id);
}

/** Tries a failed job again, as a new run. */
export function retryJob(job: TutorJob): Promise<TutorJob> {
  const again: TutorJob = {
    ...job,
    state: "running",
    error: undefined,
    runId: undefined,
    restarts: (job.restarts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  useTutorStore.getState().saveJob(again);
  void run(again);
  return Promise.resolve(again);
}

/** Reads a finished reply into what the run makes; false when the reply had no usable result. */
function settle(job: TutorJob, reply: string): string | undefined {
  const tutor = useTutorStore.getState();
  const now = new Date().toISOString();
  const base = {
    notebookId: job.notebookId,
    createdAt: now,
    updatedAt: now,
  };
  const fallbackTitle = job.title.replace(/^[^:]+:\s*/, "");
  if (job.kind === "deck") {
    const deck = parseDeck(reply);
    if (!deck) return undefined;
    return tutor.newDeck({ ...base, title: deck.title || fallbackTitle }, deck.cards).id;
  }
  if (job.kind === "quiz") {
    const quiz = parseQuiz(reply);
    if (!quiz) return undefined;
    const id = `quiz-${crypto.randomUUID()}`;
    tutor.saveGuide({
      ...base,
      id,
      kind: "quiz",
      title: quiz.title || fallbackTitle,
      body: "",
      questions: quiz.questions,
    });
    return id;
  }
  if (job.kind === "infographic") {
    const svg = parseInfographic(reply);
    if (!svg) return undefined;
    const id = `infographic-${crypto.randomUUID()}`;
    tutor.saveGuide({ ...base, id, kind: "infographic", title: fallbackTitle, body: svg });
    return id;
  }
  if (job.kind === "video") {
    const video = parseVideo(reply);
    if (!video) return undefined;
    const id = `video-${crypto.randomUUID()}`;
    tutor.saveGuide({
      ...base,
      id,
      kind: "video",
      title: video.title || fallbackTitle,
      body: "",
      scenes: video.scenes,
      audio: { state: "making" },
    });
    // The scenes are kept even without a speech key; they play with captions then.
    void makeVideoAudio(id);
    return id;
  }
  if (job.kind === "mindmap") {
    const map = parseMindmap(reply);
    if (!map) return undefined;
    const id = `mindmap-${crypto.randomUUID()}`;
    tutor.saveGuide({ ...base, id, kind: "mindmap", title: map.title, body: "", map: map.root });
    return id;
  }
  if (job.kind === "research" && job.notebookId) {
    const found = parseResearch(reply);
    if (!found.length) return undefined;
    const notebookId = job.notebookId;
    const have = new Set(
      (tutor.notebooks[notebookId]?.sources ?? []).map((source) => source.url).filter(Boolean),
    );
    for (const item of found.filter((item) => !have.has(item.url))) {
      void addLink(notebookId, item.url, item.title).then(() => undefined);
      const added = useTutorStore
        .getState()
        .notebooks[notebookId]?.sources.find((source) => source.url === item.url);
      if (added)
        tutor.updateSource(notebookId, added.id, { why: item.why, agent: agentTag(job.agentId) });
    }
    return notebookId;
  }
  if (job.kind === "brief" && job.notebookId) {
    const brief = parseBrief(reply);
    const notebook = tutor.notebooks[job.notebookId];
    if (!brief || !notebook) return undefined;
    tutor.updateNotebook(notebook.id, (current) => ({
      ...current,
      emoji: brief.emoji || current.emoji,
      // The agent names a notebook only while the person hasn't.
      title: current.title === "Untitled notebook" && brief.title ? brief.title : current.title,
      brief: {
        summary: brief.summary,
        topics: brief.topics,
        questions: brief.questions,
        sources: briefKey(current),
      },
    }));
    return notebook.id;
  }
  if (job.kind === "overview") {
    const overview = parseOverview(reply);
    if (!overview) return undefined;
    const id = `overview-${crypto.randomUUID()}`;
    tutor.saveGuide({
      ...base,
      id,
      kind: "overview",
      title: overview.title || fallbackTitle,
      body: "",
      script: overview.lines,
      audio: { state: "making" },
    });
    // The script is kept even when the speech key is missing; the audio can be made again.
    void makeOverviewAudio(id);
    return id;
  }
  const markdown = parseMarkdown(reply);
  if (!markdown) return undefined;
  if (job.kind === "slides") {
    const id = `slides-${crypto.randomUUID()}`;
    if (slidesOf(markdown.body).length < 2) return undefined;
    tutor.saveGuide({
      ...base,
      id,
      kind: "slides",
      title: markdown.title || fallbackTitle,
      body: markdown.body,
    });
    return id;
  }
  if (job.kind === "guide") {
    const id = `guide-${crypto.randomUUID()}`;
    tutor.saveGuide({
      ...base,
      id,
      kind: "guide",
      report: job.report,
      title: markdown.title || fallbackTitle,
      body: markdown.body,
    });
    return id;
  }
  if (!job.notebookId) return undefined;
  if (job.kind === "summary" && job.sourceId) {
    tutor.updateSource(job.notebookId, job.sourceId, { summary: markdown.body });
    return job.sourceId;
  }
  return tutor.saveNote(job.notebookId, {
    title: fallbackTitle,
    body: markdown.body,
    origin: "agent",
    transformation: job.transformation,
    sourceId: job.sourceId,
    agent: agentTag(job.agentId),
  }).id;
}

/** Whether a run failed because Misty closed or restarted under it, not because of its work. */
export function interrupted(error?: string): boolean {
  return /account changed|closed before|Open Misty again|stopped before it finished/i.test(
    error ?? "",
  );
}

/**
 * Picks up the jobs that were running when Misty closed: one whose run native code still knows is
 * followed to its end (its answer is kept), one it doesn't is started again once, and one from
 * before the default engine (queued in a chat) starts fresh.
 */
async function resumeJobs() {
  for (const job of Object.values(useTutorStore.getState().jobs)) {
    if (job.state === "queued") {
      void retryJob({ ...job, restarts: (job.restarts ?? 0) - 1 });
      continue;
    }
    if (job.state !== "running") continue;
    const state = job.runId ? await readRunState(job.runId).catch(() => "missing") : "missing";
    if (state !== "missing" && job.runId) {
      void run(job, job.runId);
      continue;
    }
    if ((job.restarts ?? 0) < 1) void retryJob(job);
    else
      useTutorStore.getState().saveJob({
        ...job,
        state: "failed",
        error: "This run stopped before it finished.",
        updatedAt: new Date().toISOString(),
      });
  }
}

/** Keeps the Lab's jobs going while this window is open. */
export function followTutorJobs(accountId: string): () => void {
  void useTutorStore
    .getState()
    .load(accountId)
    .then(() => {
      void resumeJobs();
      // Audio that was being spoken when Misty closed is made again.
      const tutor = useTutorStore.getState();
      for (const guide of Object.values(tutor.guides)) {
        if (guide.audio?.state === "making")
          void (guide.kind === "video" ? makeVideoAudio(guide.id) : makeOverviewAudio(guide.id));
      }
    });
  return () => undefined;
}
