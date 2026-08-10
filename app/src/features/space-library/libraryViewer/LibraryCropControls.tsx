import type { LibraryEditDefinition } from "@/services/spaces/dto/types/types";
import { Button } from "@/shared/ui";
import type { Dispatch, SetStateAction } from "react";
import { LibraryEditRange } from "../SpaceLibraryViewerUtils";

const cropPresets = [
  { label: "Original", crop: undefined },
  { label: "Square", crop: { x: 0.125, y: 0, width: 0.75, height: 1 } },
  { label: "Wide", crop: { x: 0, y: 0.125, width: 1, height: 0.75 } },
] as const;

export function LibraryCropControls({
  draft,
  onChange,
}: {
  draft: LibraryEditDefinition;
  onChange: Dispatch<SetStateAction<LibraryEditDefinition>>;
}) {
  return (
    <div className="mt-4">
      <p className="m-0 text-[10px] font-medium capitalize text-cream-muted">
        Crop &amp; Straighten
      </p>
      <LibraryEditRange
        label="Straighten"
        value={draft.straighten}
        min={-45}
        max={45}
        step={0.5}
        onChange={(value) => onChange((current) => ({ ...current, straighten: value }))}
      />
      <div className="mt-2 flex gap-1">
        {cropPresets.map(({ label, crop }) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            type="button"
            onClick={() => onChange((current) => ({ ...current, crop }))}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
