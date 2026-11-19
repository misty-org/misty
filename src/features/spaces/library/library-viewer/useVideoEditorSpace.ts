import { useMemo } from "react";
import type { VideoDestination, VideoEditorProps, VideoSpaceMedia } from "@/features/files";
import { recognizeAudioWords, useSpeechSupport } from "@/features/voice";
import { notify } from "@/shared/ui";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryItemMIME } from "../library-primitives/libraryMediaTypes";

/** One of the Space's files as a File the editor can read. */
export async function libraryFile(spaceId: string, item: SpaceLibraryItem): Promise<File> {
  const blob = await spacesApi.libraryContent(spaceId, item.id);
  const name = item.file.original_filename || item.display_name;
  return new File([blob], name, { type: blob.type || libraryItemMIME(item) });
}

/** Reads one of the Space's files by its item's id. */
export async function libraryFileById(spaceId: string, itemId: string): Promise<File> {
  return libraryFile(spaceId, await spacesApi.libraryItem(spaceId, itemId));
}

/**
 * What the video editor reaches in the Space it was opened from: its Media to add from, saving
 * an export into Media (for those who can add to it), and the computer's own speech recognition
 * for captions where it has one.
 */
export function useVideoEditorSpace(
  spaceId: string,
  canEdit: boolean,
  onSaved: () => void,
): Pick<VideoEditorProps, "destination" | "spaceMedia" | "transcribe"> {
  const speech = useSpeechSupport();
  const destination = useMemo<VideoDestination | undefined>(
    () =>
      canEdit
        ? {
            label: "Save to Media",
            save: async ({ blob, filename }) => {
              await spacesApi.uploadLibraryBlob(spaceId, blob, filename, "library");
              notify({ message: `Saved “${filename}” to Media` });
              onSaved();
            },
          }
        : undefined,
    [canEdit, onSaved, spaceId],
  );
  const spaceMedia = useMemo<VideoSpaceMedia>(
    () => ({
      spaceId,
      listAudio: async () => {
        const { items } = await spacesApi.libraryItems(spaceId, {
          media_type: "audio",
          sort: "recently-added",
          direction: "desc",
          limit: 200,
        });
        return items.map((audio) => ({ id: audio.id, name: audio.display_name }));
      },
      load: (itemId) => libraryFileById(spaceId, itemId),
    }),
    [spaceId],
  );
  return {
    destination,
    spaceMedia,
    // Captions come from the computer's own speech recognition, offered only where it has one.
    transcribe: speech?.recognition ? recognizeAudioWords : undefined,
  };
}
