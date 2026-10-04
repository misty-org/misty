import { companionRequestsBrowser } from "@/features/misty/companionBrowserIntent";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { requestsScreenContext } from "./companionIntent";
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
    const current = useMistyStore.getState();
    if (request.conversationId && request.conversationId !== current.activeConversationId)
      throw new Error("The conversation changed. Send your request in the intended conversation.");
    if (useMistyStore.getState().working) {
      if (request.attachments?.length)
        throw new Error("Follow-ups can contain text only; keep attachments for the next task.");
      await useMistyStore.getState().steerResponse?.(request.prompt, request.conversationId);
      return;
    }
    const selectedMode = current.executionMode ?? "user";
    const executionMode =
      selectedMode === "user" && companionRequestsBrowser(request.prompt) ? "team" : selectedMode;
    const needsCapture = executionMode !== "team" && requestsScreenContext(request.prompt);
    if (needsCapture && !s.nativeReady)
      throw new Error("The companion is starting. Try again in a moment.");
    const origin = {
      conversationId: request.conversationId,
      agentId: useMistyStore.getState().selectedAgentId,
    };
    if (!(await s.interruptNative())) return;
    // Typed turns use the durable text runtime. An idle voice connection must
    // not report provider failures into this turn or narrate its result.
    s.closeConversationVoice();
    const generation = s.turn;
    s.invocationId = undefined;
    s.captures = [];
    s.change({ visible: true, phase: "processing", error: undefined });
    const controller = new AbortController();
    s.abort = controller;
    try {
      const screens = needsCapture ? await s.capture(generation, controller.signal) : [];
      if (!s.originIsCurrent(origin))
        throw new Error(
          "The conversation changed. Send your request again in the intended conversation.",
        );
      await this.submitCaptured(request, generation, screens, controller.signal, executionMode);
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
    executionMode: "user" | "agent" | "team",
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
          executionMode,
          interactionMode: s.state.mode,
          displayCaptures: screens,
          model: s.state.model,
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
    if (!s.invocationId) {
      s.owned = false;
      throw new Error(current.error || "The companion could not start. Please try again.");
    }
    s.settle();
    this.voice.settleDelegatedTask();
  }
}
