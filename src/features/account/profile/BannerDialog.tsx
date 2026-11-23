import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  ImageCropFrame,
  type CropRect,
} from "@misty/ui";
import { MAX_PICTURE_BYTES } from "@/shared/lib/square_png";
import { bannerRatio, fullBannerCrop, toBannerPng } from "@/shared/lib/banner_png";
import { accountApi } from "../api/api";
import { useUserStore } from "../sessions/use_user_store";

interface Picked {
  image: ImageBitmap;
  url: string;
}

export function BannerDialog({ file, onClose }: { file: File | null; onClose(): void }) {
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => (open ? undefined : onClose())}>
      {file ? (
        <BannerCrop key={`${file.name}:${file.lastModified}`} file={file} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function BannerCrop({ file, onClose }: { file: File; onClose(): void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    let made: Picked | null = null;
    void createImageBitmap(file)
      .then((image) => {
        made = { image, url: URL.createObjectURL(file) };
        if (!live) return;
        setPicked(made);
        setCrop(fullBannerCrop(image.width, image.height));
      })
      .catch(() => live && setError("That image couldn't be read. Try a PNG, JPEG or WebP."));
    return () => {
      live = false;
      if (made) {
        URL.revokeObjectURL(made.url);
        made.image.close();
      }
    };
  }, [file]);

  const save = async () => {
    if (!picked || !crop) return;
    setError("");
    setSaving(true);
    try {
      const png = await toBannerPng(picked.image, crop);
      if (png.size > MAX_PICTURE_BYTES) throw new Error("That image is too large.");
      const { banner_version } = await accountApi.uploadBanner(png);
      useUserStore.getState().patchMe({ banner_version });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your banner couldn't be changed.");
    } finally {
      setSaving(false);
    }
  };

  const shape = picked ? picked.image.width / picked.image.height : bannerRatio;
  return (
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>Banner</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="grid justify-items-center gap-2">
          {picked && crop ? (
            <div
              className="relative"
              style={{ aspectRatio: `${shape}`, width: `min(100%, calc(60vh * ${shape}))` }}
            >
              <img
                src={picked.url}
                alt=""
                draggable={false}
                className="block size-full select-none"
              />
              <ImageCropFrame
                rect={crop}
                ratio={bannerRatio}
                label="Banner crop"
                onChange={setCrop}
              />
            </div>
          ) : null}
          <FieldError message={error} />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button size="lg" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="lg"
          variant="primary"
          disabled={!picked || saving}
          onClick={() => void save()}
        >
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
