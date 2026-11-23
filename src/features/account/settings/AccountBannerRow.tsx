import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/account_types";
import { useAccountBannerUrl } from "../hooks/use_account_banner_url";
import { BannerDialog } from "../profile/BannerDialog";
import { useUserStore } from "../sessions/use_user_store";
import { Button, FileInput, Surface, useNotice } from "@misty/ui";
import { useRef, useState } from "react";
import { DesktopSettingsRow as Row } from "@/features/settings";
import { PICTURE_TYPES } from "@/shared/lib/square_png";

export function AccountBannerRow({ account }: { account: AccountMeResponse }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const bannerUrl = useAccountBannerUrl(account.id, account.banner_version);
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const remove = async () => {
    setError("");
    setWorking(true);
    try {
      const { banner_version } = await accountApi.removeBanner();
      useUserStore.getState().patchMe({ banner_version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your banner couldn't be removed.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <Row label="Banner" description="Best at 1500 by 500 pixels">
      {bannerUrl ? (
        <Surface tone="well" radius="md" className="h-9 w-27 overflow-hidden">
          <img src={bannerUrl} alt="" draggable={false} className="block size-full object-cover" />
        </Surface>
      ) : null}
      <FileInput
        ref={input}
        accept={PICTURE_TYPES}
        aria-label="Banner"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <Button variant="secondary" disabled={working} onClick={() => input.current?.click()}>
        Change
      </Button>
      {account.banner_version ? (
        <Button variant="quiet" disabled={working} onClick={() => void remove()}>
          Remove
        </Button>
      ) : null}
      <BannerDialog file={file} onClose={() => setFile(null)} />
    </Row>
  );
}
