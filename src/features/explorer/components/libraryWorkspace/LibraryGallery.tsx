import { Button } from "@/ui";
import { File } from "lucide-react";
import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";
import { GlobalPreviewDialog } from "../GlobalPreview";
import { libraryAssetPreview } from "./LibraryDetailPrimitives";
import { joinPath } from "./savedSearchRules";
import { LegacyLibraryAssetViewer } from "./LegacyLibraryAssetViewer";

export function LibraryGallery(props: {
  assets: SmartLibraryAsset[];
  rootPath: string;
  onOpen: (assetId: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {props.assets.map((asset) => (
        <LibraryGalleryTile
          key={asset.assetId}
          asset={asset}
          rootPath={props.rootPath}
          onOpen={() => props.onOpen(asset.assetId)}
        />
      ))}
    </div>
  );
}

function LibraryGalleryTile(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onOpen: () => void;
}) {
  const preview = libraryAssetPreview(props.asset, props.rootPath);
  return (
    <Button
      type="button"
      variant="ghost"
      className="group block h-auto min-w-0 overflow-hidden rounded-lg bg-charcoal-card p-0 text-left shadow-xs inset-ring-1 inset-ring-cream/10 transition hover:-translate-y-0.5 hover:shadow-md"
      aria-label={`View ${props.asset.name}`}
      title={props.asset.name}
      onClick={props.onOpen}
    >
      <span className="relative block aspect-square overflow-hidden bg-charcoal-card">
        {preview ? (
          <img
            className="size-full object-cover transition duration-200 group-hover:scale-[1.025]"
            src={preview}
            alt=""
          />
        ) : (
          <span className="grid size-full place-items-center bg-charcoal-card text-cream-muted">
            <File size={34} strokeWidth={1.5} />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 block bg-charcoal-workspace px-3 py-2.5">
          <strong className="block truncate text-sm text-cream-bright">{props.asset.name}</strong>
          <span className="mt-0.5 block truncate text-[11px] text-cream-bright/65">
            {props.asset.assetKind ||
              props.asset.extension.replace(/^\./, "").toUpperCase() ||
              "File"}
          </span>
        </span>
      </span>
    </Button>
  );
}

export function LibraryAssetViewer(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onClose: () => void;
  onSetTags: (tags: string[]) => Promise<void>;
}) {
  const path = joinPath(props.rootPath, props.asset.relativePath);
  return (
    <GlobalPreviewDialog
      source={{
        path,
        name: props.asset.name,
        extension: props.asset.extension,
        mimeType: props.asset.mimeType,
        sizeBytes: props.asset.sizeBytes,
        modifiedMs: props.asset.modifiedMs,
        description: props.asset.description,
        tags: props.asset.tags,
        originalName: props.asset.name,
        readonly: props.asset.sourceKind !== "local",
        remote: props.asset.sourceKind !== "local",
      }}
      onClose={props.onClose}
      onSaveMetadata={(_caption, tags) => props.onSetTags(tags)}
    />
  );
}
