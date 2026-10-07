import type { SmartLibraryAsset } from "@/native/ipc";
import { FileNameIcon } from "@/features/file-ui";
import { formatBytes } from "@/shared/lib/fileFormat";
import { CollectionItems } from "@/shared/ui";
import { LibraryGallery } from "./LibraryGallery";

export function LibraryAssetItems(props: {
  assets: SmartLibraryAsset[];
  rootPath: string;
  view: "list" | "grid";
  sortResetKey: string;
  onOpen: (assetId: string) => void;
}) {
  if (props.view === "grid") return <LibraryGallery {...props} />;
  return (
    <CollectionItems
      columnSetId="library:smart"
      categoryLabel="Type"
      showLastActivity={false}
      fields={["Size", "Tags", "Collections", "Modified"]}
      sortResetKey={props.sortResetKey}
      items={props.assets.map((asset) => ({
        id: asset.assetId,
        title: asset.name,
        icon: <FileNameIcon name={asset.name} />,
        category: asset.assetKind || asset.extension.replace(/^\./, "").toUpperCase() || "File",
        updated: "",
        metadata: {
          Size: formatBytes(asset.sizeBytes),
          Tags: asset.tags.join(", ") || "—",
          Collections: asset.collections.join(", ") || "—",
          Modified: asset.modifiedMs ? new Date(asset.modifiedMs).toLocaleDateString() : "—",
        },
        sortValues: { Size: asset.sizeBytes, Modified: asset.modifiedMs || undefined },
        onOpen: () => props.onOpen(asset.assetId),
      }))}
    />
  );
}
