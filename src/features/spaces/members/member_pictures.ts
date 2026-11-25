import { accountFetchAvatar, useUserStore } from "@/features/account";
import { pictureFor, useVersionedPicture } from "@/shared/lib/versioned_picture";
import { spacesApi } from "../api/api";

export function memberPicture(userId: string, version: number) {
  return pictureFor(`person:${userId}`, version, () => spacesApi.personAvatar(userId));
}

export function myPicture(version: number) {
  const id = useUserStore.getState().me?.id ?? "";
  return pictureFor(`person:${id}`, version, accountFetchAvatar);
}

export function useMemberPicture(userId: string, version = 0) {
  return useVersionedPicture(`person:${userId}`, version, () => spacesApi.personAvatar(userId));
}
