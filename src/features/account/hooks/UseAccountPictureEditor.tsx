import { usePictureEditor } from "@/shared/hooks/UsePictureEditor";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { accountApi } from "../api/api";
import { useUserStore } from "../sessions/use_user_store";
import { seedAccountAvatar, useAccountAvatarUrl } from "./use_account_avatar_url";

export function useAccountPictureEditor() {
  const me = useUserStore((state) => state.me);
  const src = useAccountAvatarUrl(me?.id, me?.avatar_version);
  const id = me?.id ?? "";
  return usePictureEditor({
    previewKey: `person:${id}`,
    src: src || null,
    outline: avatarOutline(me?.avatar_decoration) ?? null,
    uploadPicture: async (png, url) => {
      const { avatar_version } = await accountApi.uploadAvatar(png);
      seedAccountAvatar(id, avatar_version, url);
      useUserStore.getState().patchMe({ avatar_version });
    },
    saveOutline: async (outline) => {
      await accountApi.setAvatarDecoration(outline ? { outline } : {});
    },
    showOutline: (outline) =>
      useUserStore.getState().patchMe({ avatar_decoration: outline ? { outline } : {} }),
  });
}
