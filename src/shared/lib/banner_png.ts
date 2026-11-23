import { profileBannerSize, type CropRect } from "@misty/ui";

export const bannerRatio = profileBannerSize.width / profileBannerSize.height;

export function fullBannerCrop(width: number, height: number): CropRect {
  const across = Math.min(1, (bannerRatio * height) / width);
  const down = Math.min(1, width / (bannerRatio * height));
  return { x: (1 - across) / 2, y: (1 - down) / 2, width: across, height: down };
}

export async function toBannerPng(image: ImageBitmap, crop: CropRect): Promise<Blob> {
  const sourceWidth = crop.width * image.width;
  const sourceHeight = sourceWidth / bannerRatio;
  const width = Math.round(Math.min(profileBannerSize.width, sourceWidth));
  const height = Math.round(width / bannerRatio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("That image couldn't be read.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.x * image.width,
    crop.y * image.height,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("That image couldn't be read."))),
      "image/png",
    );
  });
}
