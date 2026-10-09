import type { AiCaptureAttachment } from "@/features/ai-surface/types";
export type CompanionMode = "team" | "auto";
export type CompanionPhase = "idle" | "listening" | "processing" | "responding";
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
  source?: "desktop-display";
  screen: string;
  primary: boolean;
  display: DisplayFrame;
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
  model: string;
  models?: {
    id: string;
    name: string;
  }[];
  error?: string;
  point?: PresentedPoint;
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
