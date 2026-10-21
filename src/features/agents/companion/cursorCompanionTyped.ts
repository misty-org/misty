import { useMistyStore } from "@/features/misty/useMistyStore";
import { lessonConversation } from "../lessons/lessonEntry";
import { frontMediaContext, withinBudget, type MediaContext } from "./mediaContext";
import { nextStepPrompt, type CompanionGuideStep } from "./companionGuide";
import { companionStage } from "./companionStage";
import type { CompanionSubmission } from "./companionState";
import type { CursorCompanionSession } from "./cursorCompanionSession";
import type { CursorCompanionVoice } from "./cursorCompanionVoice";
import type { DisplayCapture } from "./protocol";

/** Typed requests sent through the companion, admitted once per identical submission. */
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
    // Teach mode: every turn at the cursor is a step in the current lesson's chat.
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
    // A continuation of a spoken request keeps its voice conversation and is
    // read aloud there; every other typed turn is silent.
    const voiceOwned =
      Boolean(request.voice) ||
      Boolean(request.continuation && this.voice.ownsContinuation(request.conversationId));
    if (!(await s.interruptNative())) return;
    // Typed turns use the durable text runtime. An idle voice connection must
    // not report provider failures into this turn or narrate its result.
    if (!voiceOwned) s.closeConversationVoice();
    const generation = s.turn;
    s.invocationId = undefined;
    s.captures = [];
    s.change({ visible: true, phase: "processing", error: undefined });
    const controller = new AbortController();
    s.abort = controller;
    try {
      // Every request at the cursor carries every display, the cursor's first
      // (docs/plans/agent-harness.md, phase 4); the model judges what matters.
      // Without screen access the request still goes, with no screenshots.
      // The video in front, read alongside the screens; it never holds the turn up.
      const media = frontMediaContext();
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
        await withinBudget(media),
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
    mediaContext?: MediaContext,
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
        "workspace",
        [],
        { conversationId: request.conversationId, context: [] },
        {
          turn: generation,
          executionMode: "user",
          interactionMode: s.state.mode,
          model: s.state.model,
          ...(screens.length ? { displayCaptures: screens } : {}),
          continuation: request.continuation,
          ...(s.state.teach ? { collaborationMode: "teach" as const } : {}),
          ...(mediaContext ? { mediaContext } : {}),
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
    // A drawing in the reply is drawn at the cursor as it streams.
    if (s.invocationId) s.sketch.follow(s.invocationId);
    if (!s.invocationId) {
      s.owned = false;
      throw new Error(current.error || "The companion could not start. Please try again.");
    }
    if (voiceOwned && s.submittedConversationId) {
      // The voice conversation points at and reads this answer when it finishes.
      s.owned = false;
      s.delegatedTask = { id: s.invocationId, conversationId: s.submittedConversationId };
    }
    s.settle();
    this.voice.settleDelegatedTask();
  }

  /** The next walkthrough step, from a fresh look at the screen after its target was clicked. */
  continueGuide = (step: CompanionGuideStep) =>
    this.submit({
      prompt: nextStepPrompt(step.point),
      conversationId: step.conversationId,
      look: true,
      continuation: true,
      voice: step.voice,
    });
}
