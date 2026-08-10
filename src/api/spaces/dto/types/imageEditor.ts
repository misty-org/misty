export interface GlobalImageMarkupElement {
  kind: "stroke" | "highlight" | "rectangle" | "text" | "cleanup";
  points?: Array<{ x: number; y: number }>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color: string;
  line_width: number;
  opacity: number;
  text?: string;
}

export interface GlobalImageEditDefinition {
  rotation: 0 | 90 | 180 | 270;
  flip_horizontal: boolean;
  flip_vertical: boolean;
  auto_enhance: boolean;
  filter: "" | "vivid" | "dramatic" | "warm" | "cool" | "mono" | "noir";
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  exposure: number;
  brilliance: number;
  highlights: number;
  shadows: number;
  black_point: number;
  vibrance: number;
  warmth: number;
  tint: number;
  sharpness: number;
  definition: number;
  noise_reduction: number;
  vignette: number;
  straighten: number;
  markup: GlobalImageMarkupElement[];
  mute: boolean;
  playback_speed: number;
  crop?: { x: number; y: number; width: number; height: number };
  trim?: { start: number; end: number };
}
