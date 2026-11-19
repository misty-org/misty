import { useCallback } from "react";
import { VideoEditor } from "@/features/files";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { libraryFile, useVideoEditorSpace } from "./useVideoEditorSpace";

/**
 * A video in Media, opened in the video editor: it starts from the video's file, and exporting
 * saves the result into Media as a new video beside it.
 */
export function LibraryVideoEditorView(props: {
  spaceId: string;
  item: SpaceLibraryItem;
  mimeType: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { spaceId, item, mimeType } = props;
  const loadSource = useCallback(async () => {
    const file = await libraryFile(spaceId, item);
    return file.type ? file : new File([file], file.name, { type: mimeType });
  }, [item, mimeType, spaceId]);
  const space = useVideoEditorSpace(spaceId, true, props.onSaved);
  return (
    <VideoEditor
      name={item.display_name}
      loadSource={loadSource}
      onClose={props.onClose}
      {...space}
    />
  );
}
