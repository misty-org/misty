import { accountFetchBanner } from "../sessions/use_account_store";
import { useEffect, useState } from "react";

export function useAccountBannerUrl(
  accountId: string | null | undefined,
  bannerVersion: number | null | undefined,
): string {
  const [bannerUrl, setBannerUrl] = useState("");

  useEffect(() => {
    setBannerUrl("");
    if (!accountId || !bannerVersion || bannerVersion < 1) return;

    let disposed = false;
    let objectUrl = "";
    void accountFetchBanner()
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setBannerUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setBannerUrl("");
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, bannerVersion]);

  return bannerUrl;
}
