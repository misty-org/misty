import { useEffect, useState } from "react";
import { accountFetchAvatar } from "@/stores/account/useAccountStore";

export function useAccountAvatarUrl(
  accountId: string | null | undefined,
  avatarVersion: number | null | undefined,
): string {
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    setAvatarUrl("");
    if (!accountId || !avatarVersion || avatarVersion < 1) return;

    let disposed = false;
    let objectUrl = "";
    void accountFetchAvatar()
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setAvatarUrl("");
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, avatarVersion]);

  return avatarUrl;
}
