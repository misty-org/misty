import type { LibraryEditDefinition } from "@/services/spaces/dto/types/types";
import { Button } from "@/shared/ui";
import { RotateCw } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { LibrarySelect } from "../SpaceLibraryPrimitives";
import {
  LibraryAdvancedAdjustments,
  LibraryEditRange,
  defaultLibraryEdit,
} from "../SpaceLibraryViewerUtils";
import { LibraryCropControls } from "./LibraryCropControls";
import { LibraryVideoTrimControls } from "./LibraryVideoTrimControls";

const filterOptions: [string, string][] = [
  ["", "None"],
  ["vivid", "Vivid"],
  ["dramatic", "Dramatic"],
  ["warm", "Warm"],
  ["cool", "Cool"],
  ["mono", "Mono"],
  ["noir", "Noir"],
];

const colorRanges = [
  { key: "brightness", label: "Brightness", min: 0, max: 2, step: 0.05 },
  { key: "contrast", label: "Contrast", min: 0, max: 2, step: 0.05 },
  { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.05 },
  { key: "grayscale", label: "Grayscale", min: 0, max: 1, step: 0.05 },
] as const;

export interface LibraryEditPanelProps {
  draft: LibraryEditDefinition;
  onChange: Dispatch<SetStateAction<LibraryEditDefinition>>;
  isImage: boolean;
  isVideo: boolean;
  durationSeconds: number;
  editSaving: boolean;
  editError: string;
  onCancel: () => void;
  onSave: () => void;
}

/** The edit sidebar: transforms, filters, colour ranges and media-specific controls. */
export function LibraryEditPanel(props: LibraryEditPanelProps) {
  const { draft, onChange } = props;
  const toggle = (key: "flip_horizontal" | "flip_vertical" | "auto_enhance") => () =>
    onChange((current) => ({ ...current, [key]: !current[key] }));

  return (
    <section className="mb-6 border-b border-charcoal-border/60 pb-5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm">Edit</h3>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => onChange(defaultLibraryEdit())}
        >
          Reset
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() =>
            onChange((current) => ({
              ...current,
              rotation: ((current.rotation + 90) % 360) as LibraryEditDefinition["rotation"],
            }))
          }
        >
          <RotateCw size={12} />
          Rotate
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={toggle("flip_horizontal")}>
          Flip H
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={toggle("flip_vertical")}>
          Flip V
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={toggle("auto_enhance")}>
          {draft.auto_enhance ? "Auto on" : "Auto"}
        </Button>
      </div>

      <label className="mt-4 grid gap-1.5 text-[10px] font-medium capitalize text-cream-muted">
        Filter
        <LibrarySelect
          value={draft.filter}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              filter: value as LibraryEditDefinition["filter"],
            }))
          }
          label="Filter"
          options={filterOptions}
        />
      </label>

      {colorRanges.map(({ key, label, min, max, step }) => (
        <LibraryEditRange
          key={key}
          label={label}
          value={draft[key]}
          min={min}
          max={max}
          step={step}
          onChange={(value) => onChange((current) => ({ ...current, [key]: value }))}
        />
      ))}
      <LibraryAdvancedAdjustments draft={draft} onChange={onChange} />

      {props.isImage ? <LibraryCropControls draft={draft} onChange={onChange} /> : null}
      {props.isVideo ? (
        <LibraryVideoTrimControls
          draft={draft}
          onChange={onChange}
          durationSeconds={props.durationSeconds}
        />
      ) : null}

      {props.editError ? (
        <p className="mb-0 mt-3 text-xs text-cream-bright">{props.editError}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          type="button"
          disabled={props.editSaving}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          size="sm"
          type="button"
          disabled={props.editSaving}
          onClick={props.onSave}
        >
          {props.editSaving ? "Saving…" : "Save edit"}
        </Button>
      </div>
    </section>
  );
}
