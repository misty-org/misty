import { Pencil } from "lucide-react";
import { Button } from "@/ui";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibrarySelect } from "../SpaceLibraryPrimitives";

const paceOptions: [string, string][] = [
  ["2", "Fast"],
  ["4.5", "Medium"],
  ["7", "Slow"],
];

const itemOptions = (items: SpaceLibraryItem[]): [string, string][] =>
  items.map((item) => [item.id, item.display_name]);

/** Cover, soundtrack and pace for the memory currently open. */
export function MemoryControls() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { currentDiscoveryGroup, canEditLibrary, visibleItems, memoryAudioItems } = data;
  if (!canEditLibrary || currentDiscoveryGroup?.kind !== "memory") return null;

  const memory = currentDiscoveryGroup;
  const update = collectionActions.updateCurrentMemory;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        type="button"
        onClick={() =>
          data.showTextDialog({
            kind: "rename-memory",
            title: "Rename memory",
            primaryLabel: "Memory title",
            primaryValue: memory.title,
          })
        }
      >
        <Pencil size={12} />
        Rename
      </Button>
      <LibrarySelect
        className="h-8 w-40"
        value={memory.cover_item_id ?? ""}
        onChange={(value) => void update({ cover_item_id: value })}
        label="Choose memory key photo"
        options={[["", "Automatic"], ...itemOptions(visibleItems)]}
      />
      <LibrarySelect
        className="h-8 w-40"
        value={memory.music_item_id ?? ""}
        onChange={(value) => void update({ music_item_id: value })}
        label="Choose memory music"
        options={[["", "No music"], ...itemOptions(memoryAudioItems)]}
      />
      <LibrarySelect
        className="h-8 w-40"
        value={String(memory.playback_seconds ?? 4.5)}
        onChange={(value) => void update({ playback_seconds: Number(value) })}
        label="Choose memory pace"
        options={paceOptions}
      />
    </div>
  );
}
