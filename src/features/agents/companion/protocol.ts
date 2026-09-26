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
  screen: string;
  primary: boolean;
  display: DisplayFrame;
}
export interface CursorSample {
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
  model: string;
  models?: {
    id: string;
    name: string;
  }[];
  error?: string;
  point?: {
    x: number;
    y: number;
    displayId: number;
    label: string;
  };
}
export const cursorEvent = "misty://cursor-sample";
export const presentationEvent = "misty://cursor-presentation";
export const controlEvent = "misty://cursor-control";
/** Only an imperative, complete mode command changes modes. Questions and quoted examples cannot. */
export function spokenMode(text: string): CompanionMode | undefined {
  const match =
    /^(?:misty[, ]+)?(?:please )?(?:switch(?: me)? to|change(?: my)? mode to|enable|enter|use) (team|auto)(?: mode)?[.!]?$/i.exec(
      text.trim(),
    );
  return match?.[1].toLowerCase() as CompanionMode | undefined;
}
