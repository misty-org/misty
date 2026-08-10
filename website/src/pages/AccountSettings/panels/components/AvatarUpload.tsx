import { useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toInitials } from "@/lib/format";
import { avatarUrl, uploadAvatar, type MeResponse } from "../../api";

const MAX_DIMENSION = 512;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The avatar endpoint accepts a raw PNG body (not multipart), capped at 5 MB and
 * 4096px. Re-encoding through a canvas normalises whatever the visitor picked —
 * HEIC, JPEG, an enormous screenshot — into something that always fits.
 */
async function toSquarePng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(side, MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read that image.");
    // Centre-crop to a square so the rendered circle never distorts.
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
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not process that image."));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

export function AvatarUpload({
  me,
  onUploaded,
}: {
  me: MeResponse;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const initials = toInitials(me.name || me.email);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setWorking(true);
    try {
      const png = await toSquarePng(file);
      if (png.size > MAX_UPLOAD_BYTES) {
        throw new Error("That image is too large. Try a smaller one.");
      }
      await uploadAvatar(png);
      onUploaded();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not update your picture.",
      );
    } finally {
      setWorking(false);
      // Allow re-selecting the same file after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-14">
        <AvatarImage src={avatarUrl(me.avatar_version)} alt="" />
        <AvatarFallback className="text-base font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {me.email}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={inputRef}
            id="account-avatar"
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Profile picture"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={working}
            aria-busy={working}
            onClick={() => inputRef.current?.click()}
          >
            {working ? <Spinner aria-hidden="true" /> : null}
            {working ? "Uploading…" : "Change picture"}
          </Button>
        </div>
        {error ? (
          <p className="mt-1 text-xs text-destructive" role="status">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
