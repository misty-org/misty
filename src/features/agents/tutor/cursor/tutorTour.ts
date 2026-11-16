import {
  effectiveValues,
  useDevicePreferences,
  writeDevicePreference,
} from "@/features/settings/preferenceAccess";
import { say } from "@/features/voice";
import type { CursorCompanionSession } from "./cursorCompanionSession";

/** A spoken turn as the tour sees it: what was asked and answered, and whether they drew on screen. */
export interface AnsweredTurn {
  prompt: string;
  reply: string;
  trail: boolean;
}

interface TourStep {
  /** What to try next, shown at the bottom of the screen and said once. */
  ask: string;
  /** Whether a turn did it. */
  done: (turn: AnsweredTurn) => boolean;
  /** A step done by dictating into a text box rather than by a turn. */
  dictation?: boolean;
}

/** How long the tour's closing line stays. */
const FAREWELL_MS = 8_000;
const talkKeys = () => (/Mac/.test(navigator.platform) ? "control and option" : "control and alt");

/** The dictation key as said aloud: the person's own from Settings › Voice, or the default. */
function dictationKeys(): string | undefined {
  const settings = useDevicePreferences.getState().state;
  const values = settings ? effectiveValues(settings) : {};
  if (values["voice.dictation.enabled"] === false) return undefined;
  const chosen = String(values["voice.dictation.shortcut"] ?? "").trim();
  if (chosen) return chosen.replace(/\+/g, " and ").toLowerCase();
  return /Mac/.test(navigator.platform) ? "fn" : "right alt";
}

/**
 * The steps: say hello, watch it draw, circle something and ask about it, type by voice, and be
 * walked through something in the app in front. Each waits until the person has actually done it.
 */
function tourSteps(): TourStep[] {
  const keys = talkKeys();
  const dictation = dictationKeys();
  return [
    {
      ask: `Hi, I'm Misty. Hold ${keys} anywhere and say hello.`,
      done: () => true,
    },
    {
      ask: `I explain by drawing. Hold ${keys} and ask me to draw something, like how a bike's gears work.`,
      done: (turn) => turn.reply.includes("```misty-sketch"),
    },
    {
      ask: `Point with the pointer too. Hold ${keys}, circle something on your screen, and ask what it is.`,
      done: (turn) => turn.trail,
    },
    ...(dictation
      ? [
          {
            ask: `You can type with your voice too. Click into any text box, hold ${dictation}, and say a sentence.`,
            done: () => false,
            dictation: true,
          },
        ]
      : []),
    {
      ask: "Last one. Ask me how to do something in the app you're in, and I'll walk you through it, one click at a time.",
      done: (turn) => /\[GUIDE:\d+\/\d+\]/.test(turn.reply),
    },
  ];
}

/** Saying this skips the rest of the tour. */
const skipping = /\b(skip|stop|end|quit|cancel)\b.*\btour\b|^\s*skip\b/i;

/**
 * Tutor's hands-on tour, after HeyClicky's: rather than reading about Tutor, the person does each
 * thing once, with the next ask at the bottom of the screen. It starts from Settings › Tutor, and
 * once by itself after the first spoken turn. Saying "skip the tour" ends it.
 */
export class TutorTour {
  private step = -1;
  private farewell: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly s: CursorCompanionSession) {}

  get running() {
    return this.step >= 0;
  }

  /** Starts the tour at its first step, or at `from`. */
  start = (from = 0) => {
    clearTimeout(this.farewell);
    void writeDevicePreference("agents.companion.toured", true).catch(() => undefined);
    this.show(from);
  };

  stop = () => {
    this.step = -1;
    clearTimeout(this.farewell);
    this.s.setTip(undefined);
  };

  /** A spoken turn finished: the step it did moves the tour on. */
  answered = (turn: AnsweredTurn) => {
    if (!this.running) return;
    if (skipping.test(turn.prompt)) return this.finish("Okay, tour skipped.");
    if (tourSteps()[this.step]?.done(turn)) this.next();
  };

  /** A dictation finished somewhere: the dictation step is done. */
  dictated = () => {
    if (this.running && tourSteps()[this.step]?.dictation) this.next();
  };

  private next = () => {
    const steps = tourSteps();
    if (this.step + 1 < steps.length) this.show(this.step + 1);
    else this.finish(`That's it. Hold ${talkKeys()} any time, and ask me anything.`);
  };

  private show = (index: number) => {
    const step = tourSteps()[index];
    if (!step) return this.stop();
    this.step = index;
    this.s.setTip(step.ask);
    void say(step.ask).catch(() => undefined);
  };

  private finish = (line: string) => {
    this.step = -1;
    this.s.setTip(line);
    void say(line).catch(() => undefined);
    this.farewell = setTimeout(() => {
      if (!this.running) this.s.setTip(undefined);
    }, FAREWELL_MS);
  };
}
