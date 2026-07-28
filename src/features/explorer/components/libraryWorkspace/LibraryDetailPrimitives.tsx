import { Images } from "lucide-react";
import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { joinPath } from "./savedSearchRules";

export function DetailLabel(props: { children: React.ReactNode }) {
  return <strong className="text-xs capitalize text-muted-foreground">{props.children}</strong>;
}
export function DetailStat(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] capitalize text-muted-foreground">{props.label}</span>
      <strong className="mt-0.5 block truncate font-medium" title={props.value}>
        {props.value}
      </strong>
    </div>
  );
}
export function libraryAssetPreview(asset: SmartLibraryAsset, rootPath: string) {
  return asset.sourceKind === "local" && asset.mimeType.startsWith("image/")
    ? safeTauriAssetUrl(joinPath(rootPath, asset.relativePath))
    : null;
}

export function LibraryEmpty(props: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="grid min-h-[420px] place-items-center text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <Images className="text-muted-foreground" size={34} />
        <h2 className="m-0 text-xl">{props.title}</h2>
        <p className="m-0 text-sm text-muted-foreground">{props.text}</p>
        {props.action}
      </div>
    </div>
  );
}
