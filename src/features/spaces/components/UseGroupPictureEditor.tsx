import { usePictureEditor } from "@/shared/hooks/UsePictureEditor";
import { spacesApi } from "../api/api";
import { seedSpacePicture, useSpacePicture } from "./SpaceAvatar";

export function useGroupPictureEditor(groupId: string, version: number, onSaved: () => void) {
  const src = useSpacePicture(groupId, version);
  return usePictureEditor({
    title: "Edit group picture",
    shape: "circle",
    previewKey: `space:${groupId}`,
    src,
    outline: null,
    uploadPicture: async (png, url) => {
      const { avatar_version } = await spacesApi.setSpacePicture(groupId, png);
      seedSpacePicture(groupId, avatar_version, url);
      onSaved();
    },
    saveOutline: async () => undefined,
    showOutline: () => undefined,
  });
}
