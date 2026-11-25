import { conversationForGlobalPrompt } from "../../conversations/state/global_misty_conversation_scope";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import {
  CompanionConversation,
  type ConversationTool,
  type SavedVoiceTurn,
} from "./companion_conversation";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openSettings, type SettingsSection } from "@/features/settings";
import { notify } from "@misty/ui";
import { onCall, openReading, soundOn } from "@/features/voice";
import { mergeVoiceTurn, voiceContext } from "./companion_conversation_history";
import { SpokenSentences, spokenParts } from "./companion_sentences";
import { withTrail } from "./companion_trail";
import type { CompanionOrigin, CursorCompanionSession } from "./cursor_companion_session";
import { keptTutorTurns, tutorConversation } from "./tutor_conversation";
import { CursorCompanionTasks, taskReply } from "./cursor_companion_tasks";
import { handoffAgents, openAgentThread } from "./tutor_handoff";
import { taskVoice } from "./tutor_task_voice";
import { forgetTutorStyle, rememberTutorStyle, tutorStyle } from "./tutor_style";

const mutedNotice = /Mac/.test(navigator.platform)
  ? "Your Mac is muted, so the answer is on your clipboard."
  : "Your sound is off, so the answer is on your clipboard.";

const driveNote =
  "Do this on their screen, in front of them, with desktop control in the app they're using. " +
  "Before each action, write one short plain sentence saying what you're about to do and why, " +
  "so they learn the app as you go. Don't stop to ask unless a step is risky.";

const oneMonitor =
  /\b(?:only|just)\b[^.?!]{0,30}\b(?:this|that|my|the)\s+(?:main\s+)?(?:monitor|screen|display)\b|\b(?:this|that)\s+(?:monitor|screen|display)\s+only\b/i;
const everyMonitor =
  /\b(?:all|both|every)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:monitors|screens|displays)\b/i;

export class CursorCompanionVoice {
  private narrated = new Set<string>();
  readonly tasks: CursorCompanionTasks;

  constructor(private readonly s: CursorCompanionSession) {
    this.tasks = new CursorCompanionTasks(s, () => this.settleDelegatedTask());
  }

  drive = async (request: string, conversationId: string, key: string, agent?: string) => {
    const id = await this.tool(
      {
        callId: key,
        name: "start_task",
        instruction: `${request}\n\n${driveNote}`,
        agent,
        key,
        invocationId: "",
      },
      conversationId,
    );
    if (id) this.narrate(id);
    return id;
  };

  private narrate = (invocationId: string) => {
    const s = this.s;
    const turn = s.turn;
    this.narrated.add(invocationId);
    const voice = taskVoice(s, invocationId);
    const reading = openReading(voice);
    const sentences = new SpokenSentences((sentence) => reading.add(sentence));
    let stop = () => {};
    const finished = () => {
      stop();
      void reading.end().catch(() => undefined);
    };
    stop = useMistyStore.subscribe(() => {
      if (!s.active(turn)) return finished();
      const reply = taskReply(this.s, invocationId);
      if (!reply) return;
      sentences.update(spokenParts(reply.content).text);
      if (reply.state === "completed" || reply.state === "failed" || reply.state === "canceled") {
        sentences.finish(spokenParts(reply.content).text);
        finished();
      }
    });
  };

  speechFailed = (id: string, generation: number, reason: unknown) => {
    const s = this.s;
    if (!s.active(generation)) return;
    s.stopAudio();
    s.speechRetry = id;
    const detail = reason instanceof Error ? reason.message : String(reason);
    s.change({
      phase: "idle",
      visible: true,
      error: `The answer is saved in the conversation. Speech failed: ${detail}`,
    });
  };

  speak = async (id: string, generation: number) => {
    const s = this.s;
    s.speechRetry = undefined;
    s.voicePending = true;
    const controller = s.abort ?? new AbortController();
    s.abort = controller;
    try {
      if (!s.pointPending) s.change({ phase: "processing" });
      if (!(await onCall())) {
        await this.start().readResult(id, taskVoice(s, id));
      }
      if (!s.active(generation)) return;
      s.voicePending = false;
      s.clearFocus();
      s.sketch.release();
      s.change({ phase: "idle", handoff: undefined });
      s.maybeHide();
    } catch (error) {
      if (!controller.signal.aborted) this.speechFailed(id, generation, error);
    }
  };

  saveTurn = (saved: SavedVoiceTurn, conversationId: string) => {
    if (!saved.prompt) return;
    if (this.s.disposed || useMistyStore.getState().accountId !== this.s.accountId) return;
    const handoff = this.tasks.handoffFor(saved.id);
    const turn = handoff ? { ...saved, handoff } : saved;
    useMistyStore.setState((current) => ({
      conversations: current.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const merged = mergeVoiceTurn(c, turn);
        return c.place === "tutor" ? keptTutorTurns(merged) : merged;
      }),
    }));
  };

  tool = async (tool: ConversationTool, conversationId: string) => {
    const s = this.s;
    const origin = s.conversationScope;
    if (!origin || origin.conversationId !== conversationId || !s.originIsCurrent(origin))
      throw new Error("The voice conversation changed.");
    if (!origin.tutor) return this.tasks.lesson(tool, conversationId, origin);
    const current = useMistyStore.getState();
    const task = s.delegatedTask;
    const running = Boolean(task && current.working && current.invocationId === task.id);
    if (tool.name === "get_task_status") {
      if (!task) return JSON.stringify({ state: "none" });
      return JSON.stringify({
        invocation_id: task.id,
        state: running ? "running" : "completed",
        reply: (taskReply(this.s, task.id)?.content ?? "").slice(0, 6000),
      });
    }
    if (tool.name === "reassign_task") return this.tasks.reassign(tool, conversationId);
    if (tool.name === "start_task") return this.tasks.handOff(tool, origin);
    if (!task || !running || (tool.invocationId && tool.invocationId !== task.id))
      throw new Error("No matching active task.");
    if (tool.name === "steer_task")
      await current.steerResponse?.(tool.instruction, task.conversationId);
    else if (tool.name === "cancel_task") await current.cancelResponse?.();
    else throw new Error("Unknown companion tool.");
    return task.id;
  };

  start = () => {
    const s = this.s;
    const tutor = !s.state.teach;
    if (
      s.conversationVoice &&
      s.conversationScope &&
      Boolean(s.conversationScope.tutor) === tutor &&
      s.originIsCurrent(s.conversationScope)
    )
      return s.conversationVoice;
    s.closeConversationVoice();
    const scope: CompanionOrigin = s.turnOrigin();
    s.conversationScope = scope;
    const session: CompanionConversation = new CompanionConversation({
      conversation: async () => {
        s.creatingConversation = true;
        try {
          const id = tutor
            ? await tutorConversation()
            : await conversationForGlobalPrompt(useMistyStore.getState, "");
          if (
            s.disposed ||
            useMistyStore.getState().accountId !== s.accountId ||
            s.conversationScope !== scope
          )
            throw new Error("Voice session canceled.");
          scope.conversationId = id;
          if (s.recordingOrigin) s.recordingOrigin = { ...scope };
          return id;
        } finally {
          s.creatingConversation = false;
        }
      },
      assertCurrent: () => {
        if (s.disposed || s.conversationScope !== scope || !s.originIsCurrent(scope))
          throw new Error("Voice conversation changed.");
      },
      onPlaying: () => {
        if (s.conversationVoice === session && s.state.phase !== "listening")
          s.change({ phase: "responding" });
      },
      onTranscript: (id, text) => {
        if (s.originIsCurrent(scope))
          useMistyStore.setState((current) => ({
            error: current.error?.startsWith("Voice: ") ? null : current.error,
          }));
        this.saveTurn({ id, prompt: text, reply: "", interrupted: false }, scope.conversationId);
      },
      onDone: (saved) => {
        this.saveTurn(saved, scope.conversationId);
        if (s.conversationVoice === session && s.state.phase !== "listening") {
          s.change({ phase: s.delegatedTask ? "processing" : "idle" });
          s.maybeHide();
        }
        queueMicrotask(() => this.settleDelegatedTask());
      },
      onError: (error) => {
        if (s.conversationVoice !== session) return;
        if (!scope.tutor && s.originIsCurrent(scope))
          useMistyStore.setState(() => ({ error: `Voice: ${error.message}` }));
        s.closeConversationVoice();
        s.change({ phase: "idle", visible: true, error: error.message });
      },
      onExpired: () => {
        if (s.conversationVoice === session) s.closeConversationVoice();
      },
      tool: this.tool,
      context: (conversationId) => {
        const state = useMistyStore.getState();
        const conversation = state.conversations.find((c) => c.id === conversationId);
        if (!scope.tutor) {
          const task =
            state.invocationConversationId === conversationId ? (state.invocationId ?? "") : "";
          return { history: voiceContext(conversation), task, agents: [] };
        }
        const handed = s.delegatedTask;
        const owner =
          handed?.handoff && handoffAgents().find((a) => a.id === handed.handoff!.agentId);
        const task =
          handed && owner && state.working && state.invocationId === handed.id
            ? `${owner.name} is working on "${handed.handoff!.instruction.slice(0, 300)}"`
            : "";
        return {
          history: voiceContext(conversation),
          task,
          agents: handoffAgents().map((agent) => agent.name),
        };
      },
      taskResult: (invocationId) => taskReply(this.s, invocationId)?.content ?? "",
      screens: async (asked) => {
        const generation = s.turn;
        if (!s.nativeReady) return [];
        const all = await s.capture(generation, new AbortController().signal);
        if (asked && everyMonitor.test(asked)) s.onlyDisplay = undefined;
        else if (asked && oneMonitor.test(asked))
          s.onlyDisplay = all.find((capture) => capture.primary)?.display.id;
        const kept =
          s.onlyDisplay === undefined
            ? all
            : all.filter((capture) =>
                capture.source === "desktop-window"
                  ? all.some((c) => c.primary && c.display.id === s.onlyDisplay)
                  : capture.display.id === s.onlyDisplay,
              );
        const captured = kept.some((capture) => capture.source !== "desktop-window") ? kept : all;
        const focused = await s.withFocusCapture(captured, generation);
        const { screens } = await withTrail(focused, generation);
        s.captures = screens;
        return screens;
      },
      companionMode: () => s.state.mode,
      present: (reply, runId) => {
        if (s.conversationVoice === session)
          s.pointer.present(reply, runId, true, scope.tutor ? scope.conversationId : undefined);
      },
      drawing: (answer, id, shown) => {
        if (s.conversationVoice === session) s.sketch.show(answer, `voice:${id}`, shown);
      },
      drawingRead: () => {
        if (s.conversationVoice === session) s.sketch.readOut();
      },
      onNothingHeard: () => {
        if (s.conversationVoice === session) s.notice("I didn't hear anything.", 2_500);
      },
      openPage: (url) => {
        if (s.conversationVoice === session) void openUrl(url).catch(() => undefined);
      },
      openSettingsPage: (page) => {
        if (s.conversationVoice !== session) return;
        const window = getCurrentWindow();
        void window
          .show()
          .then(() => window.setFocus())
          .catch(() => undefined);
        openSettings(page as SettingsSection);
      },
      openChat: () => {
        if (s.conversationVoice === session) this.tasks.openHandoff();
      },
      takeHanded: () => {
        const handed = s.handed;
        s.handed = undefined;
        return handed;
      },
      style: tutorStyle,
      remember: (line) => void rememberTutorStyle(line).catch(() => undefined),
      forget: () => void forgetTutorStyle().catch(() => undefined),
      drive: (request, conversationId, key, agent) =>
        this.drive(request, conversationId, key, agent),
      onMuted: () => {
        if (s.conversationVoice !== session) return;
        s.notice(mutedNotice);
        if (/Mac/.test(navigator.platform))
          notify({
            id: "tutor-muted",
            message: mutedNotice,
            action: { label: "Turn sound on", onSelect: () => void soundOn().catch(() => {}) },
          });
      },
      onCaption: (sentence) => {
        if (s.conversationVoice === session) s.setSpoken(sentence);
      },
      onAnswered: (turn) => {
        if (s.conversationVoice !== session) return;
        if (s.tour.running) return s.tour.answered(turn);
        if (!s.toured) {
          s.toured = true;
          s.tour.start(1);
        }
      },
    });
    s.conversationVoice = session;
    return session;
  };

  settleDelegatedTask = () => {
    const s = this.s;
    let task = s.delegatedTask;
    const current = useMistyStore.getState();
    if (
      !task ||
      s.disposed ||
      current.accountId !== s.accountId ||
      (!task.handoff && current.activeConversationId !== task.conversationId)
    )
      return;
    this.tasks.showHandoff();
    if (task.awaitingContinuation) {
      if (
        current.invocationId &&
        current.invocationId !== task.id &&
        current.invocationConversationId === task.conversationId
      ) {
        task = {
          id: current.invocationId,
          conversationId: task.conversationId,
          handoff: task.handoff,
        };
        s.delegatedTask = task;
      } else if (openingScreen(taskReply(this.s, task.id)?.screenRequest?.state)) return;
    }
    if (
      current.working ||
      current.invocationId !== task.id ||
      s.state.phase === "listening" ||
      s.state.phase === "responding"
    )
      return;
    const reply = taskReply(this.s, task.id);
    if (
      reply?.state === "completed" &&
      !task.awaitingContinuation &&
      openingScreen(reply.screenRequest?.state)
    ) {
      s.delegatedTask = { ...task, awaitingContinuation: true };
      return;
    }
    s.delegatedTask = undefined;
    const shown = s.state.handoff?.task === task.id ? s.state.handoff : undefined;
    if (reply?.state === "completed") {
      s.change({ visible: true, handoff: shown && { ...shown, state: "done" } });
      if (shown)
        notify({
          id: `tutor-handoff-${task.id}`,
          message: `${shown.agent.name} is done`,
          action: {
            label: "Open chat",
            onSelect: () => openAgentThread(shown.agent.id, shown.conversationId),
          },
        });
      s.pointer.present(reply.content, task.id, true);
      if (this.narrated.delete(task.id)) {
        s.change({ phase: "idle", handoff: undefined });
        s.maybeHide();
        return;
      }
      void this.speak(task.id, s.turn);
      return;
    }
    if (shown) {
      s.change({ handoff: undefined });
      s.notice(`${shown.agent.name} couldn't finish this. It's in their chat.`);
    }
    if (s.state.phase === "processing") s.change({ phase: "idle" });
    s.maybeHide();
  };

  ownsContinuation = (conversationId: string) =>
    Boolean(
      this.s.delegatedTask?.awaitingContinuation &&
      this.s.delegatedTask.conversationId === conversationId,
    );
}

function openingScreen(state: string | undefined) {
  return state === "pending" || state === "opening";
}
