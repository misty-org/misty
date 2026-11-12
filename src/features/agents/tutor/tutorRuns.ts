import { newLocalConversation } from "../conversations/state/localConversation";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { readRunState } from "../runs/invocations/invocationSubscription";
import { useCollaborationStore } from "../plans/store";
import { makeOverviewAudio, makeVideoAudio } from "./tutorAudio";
import { makeVideoClips } from "./tutorClips";
import { parseDeck, parseMarkdown, parseOverview, parseQuiz } from "./tutorPrompts";
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

/**
 * Tutor's agent runs. Each is an ordinary turn on the person's own agent (its engine, its keys) in a
 * chat of its own. A run that makes something is kept out of the
 * sidebar and read into a guide, deck, quiz or note when its reply finishes; a question or a lesson
 * opens as a chat the person reads.
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
      "workspace",
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

/** Starts a run that makes something for Tutor; it waits if another turn is working. */
export async function startJob(input: {
  kind: TutorJobKind;
  title: string;
  agentId: string;
  prompt: string;
  notebookId?: string;
  sourceId?: string;
  transformation?: string;
  report?: string;
}): Promise<TutorJob> {
  const now = new Date().toISOString();
  const conversation = newLocalConversation(input.title, undefined, input.agentId);
  useMistyStore.setState((state) => ({ conversations: [conversation, ...state.conversations] }));
  const job: TutorJob = {
    ...input,
    id: `job-${crypto.randomUUID()}`,
    conversationId: conversation.id,
    state: "queued",
    createdAt: now,
    updatedAt: now,
  };
  // Saved first, so the sidebar never shows its chat.
  useTutorStore.getState().saveJob(job);
  return launch(job);
}

/** Runs being started now, so a sweep during the start doesn't start them again. */
const launching = new Set<string>();

async function launch(job: TutorJob): Promise<TutorJob> {
  // One run starts at a time: two turns starting together trip each other's account check. A
  // run that waits stays queued, and the sweep after this start finishes starts it.
  if (launching.size > 0) return job;
  launching.add(job.id);
  try {
    return await launchNow(job);
  } finally {
    launching.delete(job.id);
    sweep();
  }
}

async function launchNow(job: TutorJob): Promise<TutorJob> {
  const started = await startRun({
    agentId: job.agentId,
    title: job.title,
    prompt: job.prompt,
    mode: "act",
    background: true,
    conversationId: job.conversationId,
  });
  // The latest copy: the reply may already have been read while the start was settling.
  const current = useTutorStore.getState().jobs[job.id] ?? job;
  if (current.state !== "queued") return current;
  const next: TutorJob = started.started
    ? { ...job, state: "running", updatedAt: new Date().toISOString() }
    : started.error
      ? { ...job, state: "failed", error: started.error, updatedAt: new Date().toISOString() }
      : job;
  if (next !== job) {
    useTutorStore.getState().saveJob(next);
    // A reply that finished during the start is read now, not at the next change.
    sweep();
  }
  return next;
}

/** Drops a run and its chat. */
export async function dismissJob(job: TutorJob): Promise<void> {
  await useMistyStore
    .getState()
    .deleteConversation(job.conversationId)
    .catch(() => undefined);
  useTutorStore.getState().removeJob(job.id);
}

/** Tries a failed run again in its own chat. */
export function retryJob(job: TutorJob): Promise<TutorJob> {
  // A finished reply is read again first: Tutor may read it now where it couldn't before.
  const conversation = useMistyStore
    .getState()
    .conversations.find((chat) => chat.id === job.conversationId);
  const reply = finalReply(conversation);
  if (reply?.state === "completed" && reply.content) {
    const resultId = settle(job, reply.content);
    if (resultId) {
      const done: TutorJob = { ...job, state: "done", error: undefined, resultId };
      useTutorStore.getState().saveJob(done);
      return Promise.resolve(done);
    }
  }
  const queued: TutorJob = { ...job, state: "queued", error: undefined };
  useTutorStore.getState().saveJob(queued);
  return launch(queued);
}

function finalReply(conversation: GlobalAiConversation | undefined) {
  const last = conversation?.messages[conversation.messages.length - 1];
  return last?.role === "assistant" ? last : undefined;
}

/** Reads a finished reply into what the run makes; false when the reply had no usable result. */
function settle(job: TutorJob, reply: string): string | undefined {
  const tutor = useTutorStore.getState();
  const now = new Date().toISOString();
  const base = {
    notebookId: job.notebookId,
    conversationId: job.conversationId,
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
    // The scenes are kept even without a speech key; they play with captions then. Each is filmed
    // once its narration is spoken, so the clip runs as long as the voice over it.
    void makeVideoAudio(id).then(() => makeVideoClips(id));
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
      if (added) tutor.updateSource(notebookId, added.id, { why: item.why });
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
  }).id;
}

/** Checks each unfinished run against its chat: reads finished replies, starts waiting runs. */
function sweep() {
  const { jobs, ready } = useTutorStore.getState();
  if (!ready) return;
  const chats = useMistyStore.getState();
  // Only once this window's chats are loaded can a run start again in its own chat.
  const settled = !chats.conversationsLoading && chats.conversations.length > 0;
  for (const job of Object.values(jobs)) {
    if (
      settled &&
      job.state === "failed" &&
      interrupted(job.error) &&
      (job.restarts ?? 0) < 1 &&
      !launching.has(job.id)
    ) {
      void retryJob({ ...job, restarts: (job.restarts ?? 0) + 1 });
      continue;
    }
    if (job.state === "queued") {
      if (!chats.working && !launching.has(job.id)) void launch(job);
      continue;
    }
    if (job.state !== "running") continue;
    const conversation = chats.conversations.find((c) => c.id === job.conversationId);
    if (!conversation) continue;
    const reply = finalReply(conversation);
    if (!reply || reply.state === "pending" || reply.state === "streaming") continue;
    const now = new Date().toISOString();
    if (reply.state === "completed") {
      const resultId = settle(job, reply.content);
      useTutorStore.getState().saveJob(
        resultId
          ? { ...job, state: "done", resultId, updatedAt: now }
          : {
              ...job,
              state: "failed",
              error: "The reply had nothing Tutor could use.",
              updatedAt: now,
            },
      );
    } else {
      useTutorStore.getState().saveJob({
        ...job,
        state: "failed",
        error: reply.state === "canceled" ? "This run was stopped." : failureOf(reply.content),
        updatedAt: now,
      });
    }
  }
}

/** Whether a run failed because Misty closed or restarted under it, not because of its work. */
export function interrupted(error?: string): boolean {
  return /account changed|closed before|Open Misty again|stopped before it finished/i.test(
    error ?? "",
  );
}

/**
 * What a failed reply says went wrong. A reply cut off part way (it began its answer) failed
 * because its run stopped, not with a message of its own.
 */
export function failureOf(content: string): string {
  const text = content.trim();
  if (!text || text.startsWith("```") || text.startsWith("{") || text.length > 400)
    return "This run stopped before it finished.";
  return text;
}

/**
 * A run Misty closed under leaves its reply waiting forever, so its job looks busy for good. Once
 * this window's chats load, each busy job's run is asked how it stands; one native code no longer
 * runs, with its reply still waiting, failed as stopped, and the sweep starts it again once.
 */
async function settleOrphans() {
  for (let tries = 0; tries < 20; tries++) {
    const chats = useMistyStore.getState();
    if (!chats.conversationsLoading && chats.conversations.length) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const job of Object.values(useTutorStore.getState().jobs)) {
    if (job.state !== "running") continue;
    const conversation = useMistyStore
      .getState()
      .conversations.find((chat) => chat.id === job.conversationId);
    const reply = finalReply(conversation);
    if (!reply || (reply.state !== "pending" && reply.state !== "streaming")) continue;
    const state = reply.invocationId
      ? await readRunState(reply.invocationId).catch(() => "unknown")
      : "unknown";
    if (state === "running") continue;
    const current = useTutorStore.getState().jobs[job.id];
    if (current?.state !== "running") continue;
    useTutorStore.getState().saveJob({
      ...current,
      state: "failed",
      error: "This run stopped before it finished.",
      updatedAt: new Date().toISOString(),
    });
  }
  sweep();
}

/** Keeps Tutor's runs in step with their chats while this window is open. */
export function followTutorJobs(accountId: string): () => void {
  void useTutorStore
    .getState()
    .load(accountId)
    .then(() => {
      void settleOrphans();
      sweep();
      // Audio that was being spoken, and scenes being filmed, when Misty closed are made again.
      const tutor = useTutorStore.getState();
      for (const guide of Object.values(tutor.guides)) {
        const filming = guide.kind === "video" && guide.clips?.state === "making";
        if (filming) tutor.saveGuide({ ...guide, clips: undefined });
        if (guide.audio?.state === "making")
          void (guide.kind === "video"
            ? makeVideoAudio(guide.id).then(() => makeVideoClips(guide.id))
            : makeOverviewAudio(guide.id));
        else if (filming) void makeVideoClips(guide.id);
      }
    });
  // What changed is read from the store itself, not from the listener's arguments, so a store
  // that notifies without them (as some tests' do) still works.
  let seen = useMistyStore.getState();
  const offChats = useMistyStore.subscribe(() => {
    const state = useMistyStore.getState();
    const previous = seen;
    seen = state;
    if (!state || state.accountId !== accountId) return;
    if (state.conversations !== previous?.conversations || state.working !== previous?.working)
      sweep();
  });
  let wasReady = useTutorStore.getState().ready;
  const offTutor = useTutorStore.subscribe(() => {
    const ready = useTutorStore.getState().ready;
    if (ready && !wasReady) sweep();
    wasReady = ready;
  });
  return () => {
    offChats();
    offTutor();
  };
}
