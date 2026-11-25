import { usePictureEditor } from "@/shared/hooks/UsePictureEditor";
import { avatarOutline, type AvatarDecoration } from "@/shared/lib/avatar_decoration";
import { spacesApi } from "../api/api";
import type { Space } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { spaceCan } from "../roles/use_space_roles";
import { seedSpacePicture, useSpacePicture } from "./SpaceAvatar";

export function canChangeSpacePicture(space: Space): boolean {
  return spaceCan(space, "space.rename");
}

function patchSpace(spaceId: string, patch: Partial<Space>) {
  useSpacesStore.setState((state) => ({
    spaces: state.spaces.map((space) => (space.id === spaceId ? { ...space, ...patch } : space)),
  }));
}

export function useSpacePictureEditor(space: Space) {
  const src = useSpacePicture(space.id, space.avatar_version ?? 0);
  return usePictureEditor({
    title: "Edit Space picture",
    shape: "tile",
    previewKey: `space:${space.id}`,
    src,
    outline: avatarOutline(space.avatar_decoration) ?? null,
    uploadPicture: async (png, url) => {
      const { avatar_version } = await spacesApi.setSpacePicture(space.id, png);
      seedSpacePicture(space.id, avatar_version, url);
      patchSpace(space.id, { avatar_version });
    },
    saveOutline: async (outline) => {
      await spacesApi.setSpaceAvatarDecoration(space.id, outline ? { outline } : {});
    },
    showOutline: (outline) => {
      const decoration: AvatarDecoration = outline ? { outline } : {};
      patchSpace(space.id, { avatar_decoration: decoration });
    },
  });
}
