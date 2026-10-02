import type { SmartLibraryAsset } from "@/native/ipc";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { Images } from "lucide-react";
import { joinPath } from "./savedSearchRules";
export function libraryAssetPreview(asset: SmartLibraryAsset, rootPath: string) {
  return asset.sourceKind === "local" && asset.mimeType.startsWith("image/")
    ? safeTauriAssetUrl(joinPath(rootPath, asset.relativePath))
    : null;
}

export function LibraryEmpty(props: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="grid min-h-[420px] place-items-center text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <Images className="text-cream-muted" size={34} />
        <h2 className="m-0 text-xl">{props.title}</h2>
        <p className="m-0 text-sm text-cream-muted">{props.text}</p>
        {props.action}
      </div>
    </div>
  );
}
