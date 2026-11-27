import type { AiCaptureAttachment } from "../../runs/invocations/invocation_types";
import type { AgentProfile } from "@/shared/schemas";
import type { SketchElement } from "./companion_sketch";
type CompanionMode = "team" | "auto";
type CompanionPhase = "idle" | "listening" | "processing" | "responding";
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
  source?: "desktop-display" | "focus-region" | "desktop-window";
  screen: string;
  primary: boolean;
  display: DisplayFrame;
  app?: string;
  title?: string;
  document?: string | null;
  controls?: ScreenControl[];
  trail?: boolean;
}
export interface ScreenControl {
  label: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  reveal?: "hover";
}
export interface CursorSample {
  x: number;
  y: number;
  displays: DisplayFrame[];
  typing?: boolean;
  dragging?: boolean;
  fullscreen?: boolean;
  cursorShown?: boolean;
}
export interface Presentation {
  generation: number;
  phase: CompanionPhase;
  visible: boolean;
  enabled?: boolean;
  size?: number;
  mode: CompanionMode;
  ask?: boolean;
  teach?: boolean;
  error?: string;
  point?: PresentedPoint;
  focus?: PresentedFocus[];
  sketch?: PresentedSketch;
  tint?: string;
  captions?: boolean;
  caption?: { text: string; tip?: boolean };
  sprite?: boolean;
  spriteAway?: boolean;
  wave?: boolean;
  words?: { count: number; rate: number; at: number };
  hint?: { text: string; first: boolean };
  handoff?: PresentedHandoff;
  agent?: PresentedAgent;
}
export type PresentedAgent = Pick<AgentProfile, "id" | "name" | "engine" | "avatar">;
export interface PresentedHandoff {
  task: string;
  conversationId: string;
  agent: PresentedAgent;
  state: HandoffState;
}
export type HandoffState = "working" | "waiting" | "done" | "failed";
export interface PresentedSketch {
  id: string;
  surface: "board" | "screen" | "model";
  title?: string;
  displayId?: number;
  elements: SketchElement[];
  done: boolean;
}
export interface PresentedFocus {
  displayId: number;
  frame: PointFrame;
}
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
  label: string;
  frame?: PointFrame;
  guide?: { step: number; total: number };
  awaitingClick?: boolean;
}
export const cursorEvent = "misty://cursor-sample";
export const presentationEvent = "misty://cursor-presentation";
export const controlEvent = "misty://cursor-control";
