import { accountApi } from "@/api/account/api";
import type { AccountMeResponse } from "@/api/account/types";
import { useAccountAvatarUrl, useUserStore } from "@/features/auth";
import { Avatar, AvatarFallback, AvatarImage, Button, ErrorNotification, FileInput } from "@/shared/ui";
import { useRef, useState } from "react";
import { DesktopSettingsRow as Row } from "../../components/DesktopSettingsUI";

const MAX_DIMENSION = 512;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Crops whatever was picked to a square PNG, which is all the avatar endpoint accepts. */
async function toSquarePng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(side, MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image couldn't be read.");
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("That image couldn't be read."))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}

export function AccountPictureRow({ account }: { account: AccountMeResponse }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const avatarUrl = useAccountAvatarUrl(account.id, account.avatar_version);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setWorking(true);
    try {
      const png = await toSquarePng(file);
      if (png.size > MAX_UPLOAD_BYTES) throw new Error("That image is too large.");
      const { avatar_version } = await accountApi.uploadAvatar(png);
      useUserStore.getState().patchMe({ avatar_version });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your picture couldn't be changed.");
    } finally {
      setWorking(false);
      // Lets the same file be picked again after a failure.
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Row label="Picture">
      <Avatar size="lg">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{(account.username || account.email)[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <FileInput
        ref={input}
        accept="image/*"
        aria-label="Profile picture"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <Button variant="outline" size="sm" disabled={working} onClick={() => input.current?.click()}>
        {working ? "Uploading…" : "Change"}
      </Button>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </Row>
  );
}
