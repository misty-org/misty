import { seedPicture, useVersionedPicture } from "@/shared/lib/versioned_picture";
import { accountFetchAvatar } from "../sessions/use_account_store";

export function seedAccountAvatar(accountId: string, avatarVersion: number, url: string) {
  seedPicture(`person:${accountId}`, avatarVersion, url);
}

export function useAccountAvatarUrl(
  accountId: string | null | undefined,
  avatarVersion: number | null | undefined,
): string {
  const version = accountId && avatarVersion && avatarVersion > 0 ? avatarVersion : 0;
  return useVersionedPicture(`person:${accountId ?? ""}`, version, accountFetchAvatar) ?? "";
}
