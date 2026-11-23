import { useMistyStore } from "../../conversations/state/use_misty_store";
import { lessonConversation } from "../lessons/lesson_entry";
import {
  GUIDE_SETTLE_MS,
  nextStepPrompt,
  walkthroughFor,
  type CompanionGuideStep,
} from "./companion_guide";
import { companionStage } from "./companion_stage";
import type { CompanionSubmission } from "./companion_state";
import type { CursorCompanionSession } from "./cursor_companion_session";
import type { CursorCompanionVoice } from "./cursor_companion_voice";
import type { DisplayCapture } from "./protocol";

export class CursorCompanionTypedTurns {
  private readonly admissions = new Map<string, Promise<void>>();

  constructor(
    private readonly s: CursorCompanionSession,
    private readonly voice: CursorCompanionVoice,
  ) {}

  submit = (request: CompanionSubmission) => {
    const key = JSON.stringify([
      request.conversationId,
      request.prompt,
      request.attachments?.map((a) => a.id),
    ]);
    const existing = this.admissions.get(key);
    if (existing) return existing;
    const pending = this.submitOnce(request).finally(() => {
      if (this.admissions.get(key) === pending) this.admissions.delete(key);
    });
    this.admissions.set(key, pending);
    return pending;
  };

  private async submitOnce(request: CompanionSubmission) {
    const s = this.s;
    if (s.state.teach && !useMistyStore.getState().working)
      request = { ...request, conversationId: await lessonConversation() };
    const current = useMistyStore.getState();
    if (request.conversationId && request.conversationId !== current.activeConversationId)
      throw new Error("The conversation changed. Send your request in the intended conversation.");
    if (useMistyStore.getState().working) {
      if (request.attachments?.length)
        throw new Error("Follow-ups can contain text only; keep attachments for the next task.");
      await useMistyStore.getState().steerResponse?.(request.prompt, request.conversationId);
      return;
    }
    if (request.look && !s.nativeReady)
      throw new Error("The companion is starting. Try again in a moment.");
    const origin = {
      conversationId: request.conversationId,
      agentId: useMistyStore.getState().selectedAgentId,
    };
    const voiceOwned =
      Boolean(request.voice) ||
      Boolean(request.continuation && this.voice.ownsContinuation(request.conversationId));
    if (!(await s.interruptNative())) return;
    if (!voiceOwned) s.closeConversationVoice();
    const generation = s.turn;
    s.invocationId = undefined;
    s.captures = [];
    s.change({ visible: voiceOwned, phase: "processing", error: undefined });
    const controller = new AbortController();
    s.abort = controller;
    try {
      const screens = s.nativeReady
        ? await s.capture(generation, controller.signal).catch((error: unknown) => {
            if (request.look || controller.signal.aborted) throw error;
            return [];
          })
        : [];
      if (!s.originIsCurrent(origin))
        throw new Error(
          "The conversation changed. Send your request again in the intended conversation.",
        );
      await this.submitCaptured(
        request,
        generation,
        await s.withFocusCapture(screens, generation),
        controller.signal,
        voiceOwned,
      );
    } catch (error) {
      if (!controller.signal.aborted) s.fail(generation, error);
      throw error;
    }
  }

  private async submitCaptured(
    request: CompanionSubmission,
    generation: number,
    screens: DisplayCapture[],
    signal: AbortSignal,
    voiceOwned: boolean,
  ) {
    const s = this.s;
    if (!s.active(generation)) return;
    s.captures = screens;
    s.submittedTurn = generation;
    s.owned = true;
    await companionStage(
      useMistyStore.getState().submitAnswer(
        request.prompt,
        request.attachments ?? [],
        undefined,
        [],
        { conversationId: request.conversationId, context: [] },
        {
          turn: generation,
          executionMode: "user",
          interactionMode: s.state.mode,
          ...(screens.length ? { displayCaptures: screens } : {}),
          continuation: request.continuation,
          ...(s.state.teach ? { collaborationMode: "teach" as const } : {}),
        },
      ),
      signal,
      "Starting the response",
      60_000,
    );
    if (!s.active(generation)) return;
    const current = useMistyStore.getState();
    s.invocationId = current.invocationId;
    s.submittedConversationId = current.activeConversationId;
    if (s.invocationId && voiceOwned) s.sketch.follow(s.invocationId);
    if (!s.invocationId) {
      s.owned = false;
      throw new Error(current.error || "The companion could not start. Please try again.");
    }
    if (voiceOwned && s.submittedConversationId) {
      s.owned = false;
      s.delegatedTask = {
        id: s.invocationId,
        conversationId: s.submittedConversationId,
        handoff: s.delegatedTask?.handoff,
      };
    }
    s.settle();
    this.voice.settleDelegatedTask();
  }

  continueGuide = async (step: CompanionGuideStep) => {
    const generation = this.s.turn;
    await new Promise((settled) => setTimeout(settled, GUIDE_SETTLE_MS));
    if (!this.s.active(generation)) return;
    const place = useMistyStore
      .getState()
      .conversations.find((c) => c.id === step.conversationId)?.place;
    if (step.voice && place === "tutor") {
      this.s.change({ visible: true, phase: "processing", error: undefined });
      await this.voice
        .start()
        .submitText(nextStepPrompt(step.point, walkthroughFor(step.conversationId)));
      return;
    }
    return this.submit({
      prompt: nextStepPrompt(step.point, walkthroughFor(step.conversationId)),
      conversationId: step.conversationId,
      look: true,
      continuation: true,
      voice: step.voice,
    });
  };
}
