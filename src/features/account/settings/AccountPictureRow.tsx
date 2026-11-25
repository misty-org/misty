import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/account_types";
import { useAccountAvatarUrl } from "../hooks/use_account_avatar_url";
import { useAccountPictureEditor } from "../hooks/UseAccountPictureEditor";
import { useUserStore } from "../sessions/use_user_store";
import { Avatar, AvatarFallback, AvatarImage, Button, FaceEdit, notify } from "@misty/ui";
import { useState } from "react";
import { DesktopSettingsRow as Row } from "@/features/settings";
import { avatarOutline } from "@/shared/lib/avatar_decoration";

export function AccountPictureRow({ account }: { account: AccountMeResponse }) {
  const editor = useAccountPictureEditor();
  const [removing, setRemoving] = useState(false);
  const avatarUrl = useAccountAvatarUrl(account.id, account.avatar_version);
  const remove = async () => {
    setRemoving(true);
    try {
      const { avatar_version } = await accountApi.removeAvatar();
      useUserStore.getState().patchMe({ avatar_version });
    } catch (cause) {
      notify({
        message: cause instanceof Error ? cause.message : "Your picture couldn't be changed.",
        tone: "error",
      });
    } finally {
      setRemoving(false);
    }
  };
  return (
    <Row label="Picture">
      <span className="relative inline-flex">
        <Avatar size="lg" outline={avatarOutline(account.avatar_decoration)}>
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{(account.username || account.email)[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        {removing ? null : <FaceEdit onEdit={editor.open} label="Edit picture" />}
      </span>
      {editor.dialog}
      <Button variant="secondary" disabled={removing} onClick={editor.open}>
        Edit
      </Button>
      {account.avatar_version ? (
        <Button variant="quiet" disabled={removing} onClick={() => void remove()}>
          Remove
        </Button>
      ) : null}
    </Row>
  );
}
