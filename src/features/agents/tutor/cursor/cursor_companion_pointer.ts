import { useMistyStore } from "../../conversations/state/use_misty_store";
import {
  beginWalkthrough,
  CompanionGuideStep,
  walkthroughStepDone,
  type CompanionClick,
} from "./companion_guide";
import { companionReply, resolveFocus, resolvePoint } from "./companion_reply";
import { withoutSketch } from "./companion_sketch";
import { refinePoint, REFINE_MIN_MOVE, snapPoint, type SharpenedPoint } from "./companion_sharpen";
import type { CursorCompanionSession } from "./cursor_companion_session";
import type { PresentedPoint } from "./protocol";

export class CursorCompanionPointer {
  private token = 0;
  private step: CompanionGuideStep | undefined;
  onStep: ((step: CompanionGuideStep) => void) | undefined;

  constructor(private readonly s: CursorCompanionSession) {}

  cancel = () => {
    this.token++;
    this.step?.stop();
    this.step = undefined;
  };

  clear = () => {
    const s = this.s;
    this.cancel();
    clearTimeout(s.pointTimer);
    s.pointPending = false;
    s.change({ point: undefined });
    s.maybeHide();
  };

  present = (text: string, invocationId?: string, voice = false, conversationId?: string) => {
    const s = this.s;
    const parsed = companionReply(text);
    const estimate = resolvePoint(parsed.point, s.captures);
    const focus = (parsed.focus ?? []).flatMap((region) => resolveFocus(region, s.captures) ?? []);
    const words = withoutSketch(parsed.text).split(/\s+/).length;
    s.showFocus(focus, voice ? undefined : Math.min(20_000, Math.max(6_000, words * 350)));
    this.cancel();
    const token = this.token;
    const expected = s.turn;
    clearTimeout(s.pointTimer);
    s.pointPending = !!estimate;
    s.change({ phase: "idle", point: undefined });
    if (!estimate) return;
    const current = () => s.active(expected) && token === this.token;
    const show = (point: SharpenedPoint) =>
      this.show(
        { ...point, ...(parsed.guide ? { guide: parsed.guide } : {}) },
        voice,
        conversationId,
      );
    void (async () => {
      const snapped = await snapPoint(estimate);
      if (!current()) return;
      show(snapped ?? estimate);
      if (snapped || !invocationId) return;
      const refined = await refinePoint(estimate, invocationId, expected).catch(() => undefined);
      if (
        !refined ||
        !current() ||
        !s.state.point ||
        Math.hypot(refined.x - estimate.x, refined.y - estimate.y) < REFINE_MIN_MOVE
      )
        return;
      const resnapped = await snapPoint(refined);
      if (current() && s.state.point) show(resnapped ?? refined);
    })();
  };

  private show = (
    point: Omit<PresentedPoint, "awaitingClick">,
    voice: boolean,
    conversationId?: string,
  ) => {
    const s = this.s;
    const awaiting = Boolean(point.guide && point.guide.step < point.guide.total && this.onStep);
    const presented: PresentedPoint = awaiting ? { ...point, awaitingClick: true } : point;
    this.step?.stop();
    this.step = undefined;
    clearTimeout(s.pointTimer);
    s.pointPending = true;
    s.change({ point: presented });
    const expected = s.turn;
    if (awaiting) {
      const stepsIn = conversationId ?? useMistyStore.getState().activeConversationId;
      if (point.guide?.step === 1) beginWalkthrough(stepsIn, lastAsk(stepsIn));
      const step: CompanionGuideStep = new CompanionGuideStep(
        presented,
        expected,
        stepsIn,
        voice,
        () => {
          if (this.step === step && s.active(expected)) this.clear();
        },
      );
      this.step = step;
      void step.start().catch(() => {});
      return;
    }
    s.pointTimer = setTimeout(() => {
      if (s.active(expected)) {
        s.pointPending = false;
        s.change({
          point: undefined,
        });
        s.maybeHide();
      }
    }, 15_000);
  };

  clicked = (click: CompanionClick) => {
    const step = this.step;
    if (!step || !step.accepts(click)) return;
    this.step = undefined;
    this.token++;
    this.s.pointPending = false;
    this.s.change({ point: undefined });
    walkthroughStepDone(step.conversationId, step.point);
    this.onStep?.(step);
  };
}

function lastAsk(conversationId: string) {
  const messages =
    useMistyStore.getState().conversations.find((c) => c.id === conversationId)?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (
      message.role === "user" &&
      message.content.trim() &&
      !message.content.startsWith("I did step")
    )
      return message.content;
  }
  return "";
}
