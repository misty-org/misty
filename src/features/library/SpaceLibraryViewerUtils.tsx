import { ChevronDown } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type { LibraryEditVersion } from "@/api/spaces/dto/entities";
import type { LibraryEditDefinition } from "@/api/spaces/dto/common";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Slider } from "@/shared/ui";

import { formatBytes } from "./libraryFormat";

export function LibraryMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] capitalize text-cream-muted">{label}</dt>
      <dd className="m-0 mt-1 break-words text-cream-muted">{value || "—"}</dd>
    </div>
  );
}
export function LibraryEditRange({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[10px] font-medium capitalize text-cream-muted">
      <span>{label}</span>
      <span>{value.toFixed(2)}</span>
      <Slider
        className="col-span-2"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next ?? value)}
      />
    </label>
  );
}

export function LibraryAdvancedAdjustments({
  draft,
  onChange,
}: {
  draft: LibraryEditDefinition;
  onChange: Dispatch<SetStateAction<LibraryEditDefinition>>;
}) {
  const update = (key: keyof LibraryEditDefinition, value: number) =>
    onChange((current) => ({ ...current, [key]: value }));
  return (
    <Collapsible className="mt-4 rounded-xl bg-charcoal-card px-3 py-2">
      <CollapsibleTrigger asChild>
        <Button
          className="group h-7 w-full justify-between px-0 text-[10px] text-cream-muted"
          size="sm"
          variant="ghost"
        >
          Advanced adjustments
          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LibraryEditRange
          label="Exposure"
          value={draft.exposure}
          min={-2}
          max={2}
          step={0.05}
          onChange={(value) => update("exposure", value)}
        />
        <LibraryEditRange
          label="Brilliance"
          value={draft.brilliance}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("brilliance", value)}
        />
        <LibraryEditRange
          label="Highlights"
          value={draft.highlights}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("highlights", value)}
        />
        <LibraryEditRange
          label="Shadows"
          value={draft.shadows}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("shadows", value)}
        />
        <LibraryEditRange
          label="Black Point"
          value={draft.black_point}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("black_point", value)}
        />
        <LibraryEditRange
          label="Vibrance"
          value={draft.vibrance}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("vibrance", value)}
        />
        <LibraryEditRange
          label="Warmth"
          value={draft.warmth}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("warmth", value)}
        />
        <LibraryEditRange
          label="Tint"
          value={draft.tint}
          min={-1}
          max={1}
          step={0.05}
          onChange={(value) => update("tint", value)}
        />
        <LibraryEditRange
          label="Sharpness"
          value={draft.sharpness}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => update("sharpness", value)}
        />
        <LibraryEditRange
          label="Definition"
          value={draft.definition}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => update("definition", value)}
        />
        <LibraryEditRange
          label="Noise Reduction"
          value={draft.noise_reduction}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => update("noise_reduction", value)}
        />
        <LibraryEditRange
          label="Vignette"
          value={draft.vignette}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => update("vignette", value)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function defaultLibraryEdit(): LibraryEditDefinition {
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

export function normalizeLibraryEdit(
  definition?: Partial<LibraryEditDefinition> | null,
): LibraryEditDefinition {
  return { ...defaultLibraryEdit(), ...definition, markup: definition?.markup ?? [] };
}

export function libraryEditStyle(definition: LibraryEditDefinition) {
  const crop = definition.crop;
  const preset =
    definition.filter === "vivid"
      ? "contrast(1.08) saturate(1.28)"
      : definition.filter === "dramatic"
        ? "contrast(1.25) saturate(.82) brightness(.92)"
        : definition.filter === "warm"
          ? "sepia(.12) saturate(1.08)"
          : definition.filter === "cool"
            ? "hue-rotate(8deg) saturate(1.05)"
            : definition.filter === "mono"
              ? "grayscale(1)"
              : definition.filter === "noir"
                ? "grayscale(1) contrast(1.35) brightness(.96)"
                : "";
  const enhance = definition.auto_enhance ? "contrast(1.05) saturate(1.08) brightness(1.02)" : "";
  return {
    filter: `brightness(${definition.brightness + definition.exposure * 0.125 + definition.brilliance * 0.05 - definition.black_point * 0.04}) contrast(${definition.contrast * (1 + definition.highlights * 0.18 - definition.shadows * 0.08 + definition.black_point * 0.16)}) saturate(${definition.saturation * (1 + definition.vibrance * 0.5)}) grayscale(${definition.grayscale}) sepia(${Math.max(0, definition.warmth) * 0.08}) hue-rotate(${definition.tint * 8 - definition.warmth * 4}deg) blur(${definition.noise_reduction * 0.35}px) drop-shadow(0 0 ${definition.vignette * 16}px rgba(0,0,0,${definition.vignette * 0.6})) ${enhance} ${preset}`,
    transform: `rotate(${definition.rotation + definition.straighten}deg) scaleX(${definition.flip_horizontal ? -1 : 1}) scaleY(${definition.flip_vertical ? -1 : 1})`,
    clipPath: crop
      ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)`
      : undefined,
  };
}

export function libraryRenditionStatus(version: LibraryEditVersion): string {
  switch (version.rendition_state) {
    case "queued":
      return "Queued";
    case "processing":
      return "Rendering";
    case "ready":
      return version.rendition_byte_size
        ? `Ready · ${formatBytes(version.rendition_byte_size)}`
        : "Ready";
    case "failed":
      return "Render failed";
    default:
      return "Not rendered";
  }
}
