import { useEffect, useRef, useState } from "react";
import { ImageUp } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage, Button } from "@/ui";
import { accountFetchAvatar, accountUpdateAvatar } from "@/stores/account/useAccountStore";

export function ProfileAvatarEditor({
  name,
  email,
  initialVersion,
  disabled,
  onUpdated,
}: {
  name: string;
  email: string;
  initialVersion: number;
  disabled: boolean;
  onUpdated: (avatarVersion: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(initialVersion);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const initials = (name.trim() || email)
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    if (version < 1) {
      setAvatarUrl("");
      return;
    }
    let canceled = false;
    let objectUrl = "";
    void accountFetchAvatar()
      .then((blob) => {
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => {
        if (!canceled) setAvatarUrl("");
      });
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [version]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
      setError("Choose a PNG image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a PNG smaller than 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const nextVersion = await accountUpdateAvatar(file);
      setVersion(nextVersion);
      onUpdated(nextVersion);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload that image.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-14">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-base font-semibold">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/png,.png"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp />
            {uploading ? "Uploading…" : version > 0 ? "Change PNG" : "Upload PNG"}
          </Button>
          <span className="text-xs text-muted-foreground">Square images work best · 5 MB max</span>
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
