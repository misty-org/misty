import {
  Button,
  IconButton,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Slider,
  Text,
} from "@/shared/ui";
import { SlidersHorizontal } from "lucide-react";
import { adjustmentIds, noAdjustments, type AdjustmentId, type ImageEdit } from "./imageEdit";
import type { ImageDocument } from "./useImageDocument";

/** The few settings the popover offers; the rest of the edit's adjustments stay as they are. */
const sliders: { id: AdjustmentId; label: string }[] = [
  { id: "exposure", label: "Exposure" },
  { id: "contrast", label: "Contrast" },
  { id: "saturation", label: "Saturation" },
  { id: "warmth", label: "Warmth" },
  { id: "sharpness", label: "Sharpness" },
];

/**
 * Light and color, as Preview's Adjust Color: a small popover off the toolbar with five sliders,
 * Auto and Reset. The image changes under it as the sliders move.
 */
export function AdjustPopover(props: {
  edit: ImageEdit;
  document: Pick<ImageDocument, "change" | "preview" | "commit">;
  onAuto: () => void;
}) {
  const { edit, document } = props;
  const adjusted = adjustmentIds.some((id) => edit.adjust[id] !== 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Adjust color" aria-pressed={adjusted}>
          <SlidersHorizontal />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent size="md" side="bottom" align="start">
        <PopoverHeader title="Adjust color" />
        <PopoverBody>
          {sliders.map((slider) => (
            <AdjustmentSlider
              key={slider.id}
              label={slider.label}
              value={edit.adjust[slider.id]}
              onPreview={(value) =>
                document.preview((current) => ({
                  ...current,
                  adjust: { ...current.adjust, [slider.id]: value },
                }))
              }
              onCommit={document.commit}
            />
          ))}
        </PopoverBody>
        <PopoverActions>
          {adjusted ? (
            <Button
              variant="quiet"
              onClick={() => document.change((current) => ({ ...current, adjust: noAdjustments }))}
            >
              Reset
            </Button>
          ) : null}
          <Button variant="secondary" onClick={props.onAuto}>
            Auto
          </Button>
        </PopoverActions>
      </PopoverContent>
    </Popover>
  );
}

/** One slider with its name and value; a double click on the name sets it back to none. */
function AdjustmentSlider(props: {
  label: string;
  value: number;
  onPreview: (value: number) => void;
  onCommit: () => void;
}) {
  const shown = String(Math.round(props.value));
  const signed = props.value > 0 ? `+${shown}` : props.value < 0 ? `−${shown.slice(1)}` : shown;
  return (
    <div className="grid gap-1">
      <div
        className="flex items-center justify-between gap-2"
        onDoubleClick={() => {
          props.onPreview(0);
          props.onCommit();
        }}
      >
        <Text size="control" tone="default">
          {props.label}
        </Text>
        <Text size="meta" tone={props.value === 0 ? "muted" : "bright"} className="tabular-nums">
          {signed}
        </Text>
      </div>
      <Slider
        aria-label={props.label}
        value={[props.value]}
        min={-100}
        max={100}
        step={1}
        onValueChange={([next]) => props.onPreview(next ?? props.value)}
        onValueCommit={props.onCommit}
      />
    </div>
  );
}
