import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/accountTypes";
import { useAccountAvatarUrl } from "../hooks/useAccountAvatarUrl";
import { useUserStore } from "../sessions/useUserStore";
import { Avatar, AvatarFallback, AvatarImage, Button, FileInput, useNotice } from "@/shared/ui";
import { useRef, useState } from "react";
import { DesktopSettingsRow as Row } from "@/features/settings";
import { MAX_PICTURE_BYTES, PICTURE_TYPES, toSquarePng } from "@/shared/lib/squarePng";

export function AccountPictureRow({ account }: { account: AccountMeResponse }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const avatarUrl = useAccountAvatarUrl(account.id, account.avatar_version);
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const change = async (work: () => Promise<{ avatar_version: number }>) => {
    setError("");
    setWorking(true);
    try {
      const { avatar_version } = await work();
      useUserStore.getState().patchMe({ avatar_version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your picture couldn't be changed.");
    } finally {
      setWorking(false);
      // Lets the same file be picked again after a failure.
      if (input.current) input.current.value = "";
    }
  };
  const upload = (file: File | undefined) =>
    file &&
    void change(async () => {
      const png = await toSquarePng(file);
      if (png.size > MAX_PICTURE_BYTES) throw new Error("That image is too large.");
      return accountApi.uploadAvatar(png);
    });
  return (
    <Row label="Picture">
      <Avatar size="lg">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{(account.username || account.email)[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <FileInput
        ref={input}
        accept={PICTURE_TYPES}
        aria-label="Profile picture"
        onChange={(event) => upload(event.target.files?.[0])}
      />
      <Button variant="secondary" loading={working} onClick={() => input.current?.click()}>
        Change
      </Button>
      {account.avatar_version ? (
        <Button
          variant="quiet"
          disabled={working}
          onClick={() => void change(() => accountApi.removeAvatar())}
        >
          Remove
        </Button>
      ) : null}
    </Row>
  );
}
