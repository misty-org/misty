import { useEffect, useRef, useState } from "react";
import AvatarEditor, { type AvatarEditorRef } from "react-avatar-editor";
import { ImageUp, RotateCw } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Slider,
} from "@/ui";
import { accountFetchAvatar, accountUpdateAvatar } from "@/stores/account/useAccountStore";

const EDITOR_SIZE = 260;
const EDITOR_BORDER = 24;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

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
  const editorRef = useRef<AvatarEditorRef>(null);
  const [version, setVersion] = useState(initialVersion);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [source, setSource] = useState<File | null>(null);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState(0);
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

  function pickImage(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setScale(1.2);
    setRotation(0);
    setSource(file);
  }

  function closeEditor() {
    setSource(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function applyCrop() {
    const canvas = editorRef.current?.getImageScaledToCanvas();
    if (!canvas) return;
    setError("");
    setUploading(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result: Blob | null) => resolve(result), "image/png"),
      );
      if (!blob) throw new Error("The image could not be processed.");
      if (blob.size > MAX_OUTPUT_BYTES) throw new Error("The cropped image is too large.");
      const file = new File([blob], "avatar.png", { type: "image/png" });
      const nextVersion = await accountUpdateAvatar(file);
      setVersion(nextVersion);
      onUpdated(nextVersion);
      closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your photo.");
    } finally {
      setUploading(false);
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
            accept="image/*"
            onChange={(event) => pickImage(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp />
            {version > 0 ? "Change photo" : "Upload photo"}
          </Button>
          <span className="text-xs text-muted-foreground">JPG, PNG, or GIF · crop to fit</span>
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      <Dialog open={Boolean(source)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="w-[min(360px,calc(100vw-32px))] gap-4">
          <DialogTitle>Adjust your photo</DialogTitle>
          <DialogDescription className="sr-only">
            Drag to reposition, then zoom and rotate to frame your profile photo.
          </DialogDescription>
          <div className="flex justify-center">
            {source ? (
              <AvatarEditor
                ref={editorRef}
                image={source}
                width={EDITOR_SIZE}
                height={EDITOR_SIZE}
                border={EDITOR_BORDER}
                borderRadius={EDITOR_SIZE}
                color={[8, 9, 11, 0.6]}
                scale={scale}
                rotate={rotation}
              />
            ) : null}
          </div>
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            Zoom
            <Slider
              aria-label="Zoom"
              value={[scale]}
              min={1}
              max={3}
              step={0.01}
              onValueChange={([value]) => setScale(value ?? scale)}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              <RotateCw size={15} />
              Rotate
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={uploading} onClick={() => void applyCrop()}>
                {uploading ? "Saving…" : "Save photo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
