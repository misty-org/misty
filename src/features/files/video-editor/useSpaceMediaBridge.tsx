import { useEffect, useMemo, useRef, useState } from "react";
import { rememberSpaceItem, setSpaceMedia, type SpaceMedia } from "@opencut/media/space-media";
import { LibraryPickerPanel } from "../picker/LibraryPickerSeam";
import type { VideoSpaceMedia } from "./videoEditorTypes";

/**
 * Gives the editor's Media and Sounds tabs the Space it was opened from while it is open: its
 * audio files, and Misty's own Media picker for photos and videos. Returns the picker, to be
 * drawn while it is asked for.
 */
export function useSpaceMediaBridge(spaceMedia: VideoSpaceMedia | undefined) {
  // How many files the open picker lets be chosen (undefined for any number), or false when closed.
  const [picking, setPicking] = useState<false | { maximum?: number }>(false);
  const answer = useRef<((itemIds: string[]) => void) | null>(null);
  const bridge = useMemo<SpaceMedia | null>(() => {
    if (!spaceMedia) return null;
    return {
      pick: (options) =>
        new Promise<File[]>((resolve, reject) => {
          answer.current = (itemIds) => {
            Promise.all(
              itemIds.map(async (id) => {
                const file = await spaceMedia.load(id);
                // The file is already in Media: keeping the project points at this item.
                rememberSpaceItem(file, id);
                return file;
              }),
            ).then(resolve, reject);
          };
          setPicking(options?.single ? { maximum: 1 } : {});
        }),
      listAudio: () => spaceMedia.listAudio(),
      load: async (id) => {
        const file = await spaceMedia.load(id);
        // A sound from the Sounds tab is in Media too: keeping the project points at its item.
        rememberSpaceItem(file, id);
        return file;
      },
    };
  }, [spaceMedia]);
  useEffect(() => {
    setSpaceMedia(bridge);
    return () => setSpaceMedia(null);
  }, [bridge]);
  const close = (itemIds: string[]) => {
    setPicking(false);
    answer.current?.(itemIds);
    answer.current = null;
  };
  const picker =
    picking && spaceMedia ? (
      <LibraryPickerPanel
        spaceId={spaceMedia.spaceId}
        selectedIds={[]}
        maximumSelected={picking.maximum}
        onCancel={() => close([])}
        onChoose={close}
      />
    ) : null;
  return picker;
}
