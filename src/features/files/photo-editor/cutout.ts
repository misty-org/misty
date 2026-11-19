import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";

let supported: Promise<boolean> | null = null;

/** Whether this computer can cut a photo's subject out (macOS 14 and later), asked once. */
export function canRemoveBackground(): Promise<boolean> {
  if (!hasTauriInternals()) return Promise.resolve(false);
  supported ??= invoke<boolean>("image_cutout_supported").catch(() => false);
  return supported;
}

/** Whether the editor offers Remove background; false until the computer has answered. */
export function useCanRemoveBackground(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    void canRemoveBackground().then((answer) => live && setCan(answer));
    return () => {
      live = false;
    };
  }, []);
  return can;
}

/**
 * The image with only its subject left, over transparency, as a PNG. The computer finds the
 * subject itself (Apple's Vision); the image never leaves it.
 */
export async function removeBackground(image: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  try {
    const png = await invoke<ArrayBuffer>("image_cutout", bytes);
    return new Blob([png], { type: "image/png" });
  } catch (reason) {
    throw new Error(typeof reason === "string" ? reason : "The background couldn’t be removed.");
  }
}
