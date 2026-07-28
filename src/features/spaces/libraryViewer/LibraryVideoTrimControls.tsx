import type { Dispatch, SetStateAction } from "react";
import { Button, Input } from "@/ui";
import type { LibraryEditDefinition } from "@/models/types/features/spaces/types";
import { LibrarySelect } from "../SpaceLibraryPrimitives";

const labelClass = "grid gap-1 text-[10px] capitalize text-muted-foreground";
const speedOptions: [string, string][] = [
  ["0.5", "0.5×"],
  ["1", "1×"],
  ["1.5", "1.5×"],
  ["2", "2×"],
];

export function LibraryVideoTrimControls({
  draft,
  onChange,
  durationSeconds,
}: {
  draft: LibraryEditDefinition;
  onChange: Dispatch<SetStateAction<LibraryEditDefinition>>;
  durationSeconds: number;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <label className={labelClass}>
        Trim Start
        <Input
          type="number"
          min={0}
          step={0.1}
          value={draft.trim?.start ?? 0}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              trim: {
                start: Number(event.target.value),
                end: current.trim?.end ?? Math.max(1, durationSeconds),
              },
            }))
          }
        />
      </label>
      <label className={labelClass}>
        Trim End
        <Input
          type="number"
          min={0.1}
          step={0.1}
          value={draft.trim?.end ?? durationSeconds}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              trim: { start: current.trim?.start ?? 0, end: Number(event.target.value) },
            }))
          }
        />
      </label>
      <label className={labelClass}>
        Speed
        <LibrarySelect
          value={String(draft.playback_speed)}
          onChange={(value) =>
            onChange((current) => ({ ...current, playback_speed: Number(value) }))
          }
          label="Speed"
          options={speedOptions}
        />
      </label>
      <Button
        className="self-end"
        size="sm"
        variant="outline"
        type="button"
        onClick={() => onChange((current) => ({ ...current, mute: !current.mute }))}
      >
        {draft.mute ? "Muted" : "Mute"}
      </Button>
    </div>
  );
}
