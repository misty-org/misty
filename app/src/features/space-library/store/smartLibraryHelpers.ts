import type { SemanticReindexInput, SemanticReindexPlan } from "@/features/file-explorer";
import { smartLibraryAssetsPage, smartLibraryPreparePreviews } from "@/services/backend";
import type { FolderLibraryStatus, SmartLibraryAsset } from "@/services/misty/model/misty-api";

export function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
}
export async function loadEligibleAssets(limit: number): Promise<SmartLibraryAsset[]> {
  const assets: SmartLibraryAsset[] = [];
  let afterAssetId: string | null = null;
  do {
    const page = await smartLibraryAssetsPage({
      afterAssetId,
      limit: Math.min(500, limit),
      reindexOnly: true,
    });
    assets.push(
      ...page.assets.filter(
        (asset) =>
          asset.previewSupported && ["pending", "changed", "failed"].includes(asset.status),
      ),
    );
    afterAssetId = page.nextCursor;
  } while (afterAssetId && assets.length < limit);
  return assets.slice(0, limit);
}

export async function loadAssetsByIds(assetIds: Set<string>): Promise<SmartLibraryAsset[]> {
  const assets: SmartLibraryAsset[] = [];
  let afterAssetId: string | null = null;
  do {
    const page = await smartLibraryAssetsPage({ afterAssetId, limit: 500 });
    for (const asset of page.assets) if (assetIds.has(asset.assetId)) assets.push(asset);
    afterAssetId = page.nextCursor;
  } while (afterAssetId && assets.length < assetIds.size);
  return assets;
}

export async function prepareSemanticReindexInputs(
  library: FolderLibraryStatus,
  planned: SemanticReindexPlan["assets"],
): Promise<SemanticReindexInput[]> {
  const localAssets = new Map(library.assets.map((asset) => [asset.assetId, asset]));
  const preparedIds = planned.map((asset) => asset.assetId);
  const previews =
    preparedIds.length > 0 ? await smartLibraryPreparePreviews(preparedIds, 512) : [];
  const previewsById = new Map(previews.map((preview) => [preview.assetId, preview]));
  return planned.map((asset) => {
    const local = localAssets.get(asset.assetId);
    const preview = previewsById.get(asset.assetId);
    if (asset.requiresPreview && !preview)
      throw new Error(`Could not prepare a private preview for ${local?.name ?? asset.assetId}.`);
    return {
      assetId: asset.assetId,
      fingerprint: asset.fingerprint,
      assetKind: asset.assetKind,
      mimeType: asset.requiresPreview ? (preview?.mimeType ?? asset.mimeType) : asset.mimeType,
      ...(preview ? { base64: bytesToBase64(preview.bytes) } : {}),
      ...(preview?.extractedText || local?.extractedText
        ? { extractedText: preview?.extractedText ?? local?.extractedText ?? undefined }
        : {}),
      metadata: { ...(local ? reindexMetadata(local) : {}), ...(preview?.metadata ?? {}) },
      ...(preview ? { truncated: preview.truncated } : {}),
    };
  });
}

export function reindexMetadata(asset: SmartLibraryAsset): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (asset.description) metadata.description = asset.description;
  if (asset.tags.length > 0) metadata.tags = asset.tags.join(", ");
  if (asset.collections.length > 0) metadata.collections = asset.collections.join(", ");
  if (asset.generatedMetadata) {
    for (const [key, value] of Object.entries(asset.generatedMetadata)) {
      if (typeof value === "string" && value) metadata[key] = value;
      else if (Array.isArray(value) && value.length > 0) metadata[key] = value.join(", ");
    }
  }
  return metadata;
}
