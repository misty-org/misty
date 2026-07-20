import type {
  GlobalImageMarkupElement,
  GlobalImageEditDefinition,
} from "@/models/interfaces/features/editor/imageEditor";
export type {
  GlobalImageMarkupElement,
  GlobalImageEditDefinition,
} from "@/models/interfaces/features/editor/imageEditor";
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
