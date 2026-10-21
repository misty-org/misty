import type { AiCaptureAttachment } from "@/features/ai-surface/types";
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
  /** Misty's own visible controls on this screen, in this capture's pixels. */
  controls?: ScreenControl[];
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
  /** Activity sequence only; no key identities or typed text leave the native hook. */
  keyboardActivity?: number;
  x: number;
  y: number;
  displays: DisplayFrame[];
}
export interface Presentation {
  generation: number;
  phase: CompanionPhase;
  visible: boolean;
  enabled?: boolean;
  showCompanion?: boolean;
  /** Percentage of the default 32px companion. */
  size?: number;
  mode: CompanionMode;
  /** Require human confirmation before acquiring desktop control. Defaults off. */
  ask?: boolean;
  /** Teach mode: every turn is a lesson step that teaches and never acts. Defaults off. */
  teach?: boolean;
  model: string;
  models?: {
    id: string;
    name: string;
  }[];
  error?: string;
  point?: PresentedPoint;
  /** Teach mode: the regions to look at while Misty explains the step. */
  focus?: PresentedFocus[];
  /** A drawing the reply is making (companionSketch.ts), drawn as it streams. */
  sketch?: PresentedSketch;
}
/**
 * A drawing on its way to the overlay. A board sits beside the cursor; screen marks
 * are in the same global units as cursor samples, on one display.
 */
export interface PresentedSketch {
  /** Changes with each reply, so the overlay starts a fresh card. */
  id: string;
  surface: "board" | "screen";
  title?: string;
  displayId?: number;
  elements: import("./companionSketch").SketchElement[];
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
