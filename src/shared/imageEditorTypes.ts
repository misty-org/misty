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

export function defaultGlobalImageEdit(): GlobalImageEditDefinition {
  return {
    rotation: 0,
    flip_horizontal: false,
    flip_vertical: false,
    auto_enhance: false,
    filter: "",
    brightness: 1,
    contrast: 1,
    saturation: 1,
    grayscale: 0,
    exposure: 0,
    brilliance: 0,
    highlights: 0,
    shadows: 0,
    black_point: 0,
    vibrance: 0,
    warmth: 0,
    tint: 0,
    sharpness: 0,
    definition: 0,
    noise_reduction: 0,
    vignette: 0,
    straighten: 0,
    markup: [],
    mute: false,
    playback_speed: 1,
  };
}

export function normalizeGlobalImageEdit(
  definition?: Partial<GlobalImageEditDefinition> | null,
): GlobalImageEditDefinition {
  return { ...defaultGlobalImageEdit(), ...definition, markup: definition?.markup ?? [] };
}
