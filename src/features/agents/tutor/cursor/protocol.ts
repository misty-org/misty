import type { AiCaptureAttachment } from "../../runs/invocations/invocationTypes";
import type { AgentProfile } from "@/shared/schemas";
import type { SketchElement } from "./companionSketch";
type CompanionMode = "team" | "auto";
type CompanionPhase = "idle" | "listening" | "processing" | "responding";
/** Global coordinates are CG display points on macOS, physical pixels on Windows. */
export interface DisplayFrame {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
export interface DisplayCapture extends AiCaptureAttachment {
  capturedAt?: number;
  /** "desktop-window" is window1: the window in front, at full resolution. */
  source?: "desktop-display" | "focus-region" | "desktop-window";
  screen: string;
  primary: boolean;
  /** The captured area in global units: a whole display, or the part a window or focus region covers. */
  display: DisplayFrame;
  /** The focused window's app and title, on window1. */
  app?: string;
  title?: string;
  /** The document or web page that window has open, where the app says (a file:// or web address). */
  document?: string | null;
  /** Misty's own visible controls on this screen, in this capture's pixels. */
  controls?: ScreenControl[];
  /** The trail the person drew while asking is drawn on this screenshot (companionTrail.ts). */
  trail?: boolean;
}
/** A Misty control named by its interface; x and y are its center. */
export interface ScreenControl {
  label: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Present when the control only appears while the pointer is over it. */
  reveal?: "hover";
}
export interface CursorSample {
  x: number;
  y: number;
  displays: DisplayFrame[];
  /** Several keys in quick succession just now (only the timing, never the keys). */
  typing?: boolean;
  /** The main mouse button is held: something is being dragged. */
  dragging?: boolean;
  /** The window in front fills its display: a full-screen app or video. */
  fullscreen?: boolean;
  /** Whether the system draws the pointer now; apps hide it while typing or playing video. */
  cursorShown?: boolean;
}
export interface Presentation {
  generation: number;
  phase: CompanionPhase;
  visible: boolean;
  enabled?: boolean;
  /** Percentage of the default 32px companion. */
  size?: number;
  mode: CompanionMode;
  /** Require human confirmation before acquiring desktop control. Defaults off. */
  ask?: boolean;
  /** Teach mode: every turn is a lesson step that teaches and never acts. Defaults off. */
  teach?: boolean;
  error?: string;
  point?: PresentedPoint;
  /** Teach mode: the regions to look at while Misty explains the step. */
  focus?: PresentedFocus[];
  /** A drawing the reply is making (companionSketch.ts), drawn as it streams. */
  sketch?: PresentedSketch;
  /** The companion's color (Settings › Tutor, `companionTints`); white when unset. */
  tint?: string;
  /** Captions while Misty talks (Settings › Tutor). Defaults off. */
  captions?: boolean;
  /**
   * The line at the bottom of the screen: the sentence being said (with captions on), or what
   * the tour asks for next (`tip`).
   */
  caption?: { text: string; tip?: boolean };
  /**
   * Misty, the cloud, beside the cursor all the time instead of only while Tutor works
   * (Settings › Tutor › Show Misty at the cursor). Defaults on.
   */
  sprite?: boolean;
  /** The cloud steps away for now: while the microphone is in use by a call or a recording. */
  spriteAway?: boolean;
  /** Misty waves hello beside the pointer (the tour starting). */
  wave?: boolean;
  /**
   * The sentence Tutor is saying now, as Misty bobs with it: how many words, the speaking rate
   * from Settings › Voice, and when it began (`Date.now()`). Absent between sentences.
   */
  words?: { count: number; rate: number; at: number };
  /**
   * The shortcuts, said beside Misty in her first week: as she first shows (`first`), and after
   * the pointer has rested a minute. Absent once the week is over.
   */
  hint?: { text: string; first: boolean };
  /** Work handed to one of the person's agents: who took it and how it's going. */
  handoff?: PresentedHandoff;
}
/** The agent a hand-off went to, as the bubble beside the companion shows it. */
export interface PresentedHandoff {
  /** The turn doing the work. */
  task: string;
  conversationId: string;
  agent: Pick<AgentProfile, "id" | "name" | "engine" | "avatar">;
  state: HandoffState;
}
/** working while it runs, waiting while it needs the person, then done or failed. */
export type HandoffState = "working" | "waiting" | "done" | "failed";
/**
 * A drawing on its way to the overlay. A board sits beside the cursor; screen marks
 * are in the same global units as cursor samples, on one display.
 */
export interface PresentedSketch {
  /** Changes with each reply, so the overlay starts a fresh card. */
  id: string;
  surface: "board" | "screen" | "model";
  title?: string;
  displayId?: number;
  elements: SketchElement[];
  done: boolean;
}
/** A region outlined on screen, in the same global units as cursor samples. */
export interface PresentedFocus {
  displayId: number;
  frame: PointFrame;
}
/** A rectangle in the same global units as cursor samples. */
export interface PointFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PresentedPoint {
  x: number;
  y: number;
  displayId: number;
  /** What to do there, such as "click Source Control". */
  label: string;
  /** The real control's bounds, when Accessibility found it. */
  frame?: PointFrame;
  /** This point is one step of a walkthrough. */
  guide?: { step: number; total: number };
  /** Hold the point until the person clicks it; the next step follows. */
  awaitingClick?: boolean;
}
export const cursorEvent = "misty://cursor-sample";
export const presentationEvent = "misty://cursor-presentation";
export const controlEvent = "misty://cursor-control";
