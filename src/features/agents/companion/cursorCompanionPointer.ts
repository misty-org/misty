import { useMistyStore } from "@/features/misty/useMistyStore";
import { CompanionGuideStep, type CompanionClick } from "./companionGuide";
import { companionReply, resolvePoint } from "./companionReply";
import { refinePoint, REFINE_MIN_MOVE, snapPoint, type SharpenedPoint } from "./companionSharpen";
import type { CursorCompanionSession } from "./cursorCompanionSession";
import type { PresentedPoint } from "./protocol";

/**
 * Points at what a finished reply names, and holds walkthrough steps until
 * the person clicks them. The model's spot is snapped to the real control
 * when Accessibility finds it; otherwise it is shown at once and refined from
 * a full-resolution crop through the reply's own model.
 */
export class CursorCompanionPointer {
  /** Each reply's point; a newer reply or an interruption makes older work stale. */
  private token = 0;
  /** A walkthrough step waiting for the person to click its target. */
  private step: CompanionGuideStep | undefined;
  /** Continues a walkthrough once its step's target is clicked. */
  onStep: ((step: CompanionGuideStep) => void) | undefined;

  constructor(private readonly s: CursorCompanionSession) {}

  /** Makes in-flight sharpening stale and stops waiting for a click. */
  cancel = () => {
    this.token++;
    this.step?.stop();
    this.step = undefined;
  };

  /** Clears a shown point, for example after its display changed. */
  clear = () => {
    const s = this.s;
    this.cancel();
    clearTimeout(s.pointTimer);
    s.pointPending = false;
    s.change({ point: undefined });
    s.maybeHide();
  };

  /** `voice` marks a spoken walkthrough, whose next steps are read aloud too. */
  present = (text: string, invocationId?: string, voice = false) => {
    const s = this.s;
    const parsed = companionReply(text);
    const estimate = resolvePoint(parsed.point, s.captures);
    this.cancel();
    const token = this.token;
    const expected = s.turn;
    clearTimeout(s.pointTimer);
    s.pointPending = !!estimate;
    s.change({ phase: "idle", point: undefined });
    if (!estimate) return;
    const current = () => s.active(expected) && token === this.token;
    const show = (point: SharpenedPoint) =>
      this.show({ ...point, ...(parsed.guide ? { guide: parsed.guide } : {}) }, voice);
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

  private show = (point: Omit<PresentedPoint, "awaitingClick">, voice: boolean) => {
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
      const step: CompanionGuideStep = new CompanionGuideStep(
        presented,
        expected,
        useMistyStore.getState().activeConversationId,
        voice,
        () => {
          if (this.step === step && s.active(expected)) this.clear();
        },
      );
      this.step = step;
      // Without click hints, "next" by voice or text still continues.
      void step.start().catch(() => {});
      return;
    }
    // Handles display removal or an overlay reload before its animation completion event.
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

  /** A click while a walkthrough step waits: on its target, the next step follows. */
  clicked = (click: CompanionClick) => {
    const step = this.step;
    if (!step || !step.accepts(click)) return;
    this.step = undefined;
    this.token++;
    this.s.pointPending = false;
    this.s.change({ point: undefined });
    this.onStep?.(step);
  };
}
