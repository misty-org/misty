import type { LibraryAssetStackInput } from "@/models/types/features/spaces/SpaceLibraryPrimitives";
export type { LibraryAssetStackInput } from "@/models/types/features/spaces/SpaceLibraryPrimitives";
import { createContext, useContext, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  File,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  MessagesSquare,
  Pencil,
  Pin,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  LibraryAssetStack,
  LibraryDiscoveryGroup,
  LibraryMapPoint,
  LibrarySearchFacets,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";

import { libraryItemThumbnailEligible } from "./libraryThumbnail";

export const LibraryCanEditContext = createContext(true);

export function LibraryItemThumbnail({
  spaceId,
  item,
  reauthenticationToken = "",
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  reauthenticationToken?: string;
}) {
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const mimeType = libraryItemMIME(item);
  const visual =
    libraryItemThumbnailEligible(mimeType, item.file.original_filename) ||
    Number(item.file.intrinsic_metadata.width ?? 0) > 0;
  useEffect(() => {
    if (!visual) {
      setPreview(null);
      return;
    }
    let current = true;
    let objectUrl = "";
    const request = spacesApi
      .libraryPreview(spaceId, item.id, reauthenticationToken, item.version)
      .catch(() =>
        mimeType.startsWith("image/") || mimeType === "application/pdf"
          ? spacesApi.libraryContent(spaceId, item.id, reauthenticationToken)
          : Promise.reject(new Error("The file reader could not load this item")),
      );
    void request
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({
          url: objectUrl,
          kind:
            blob.type === "application/pdf" ||
            (mimeType === "application/pdf" && !blob.type.startsWith("image/"))
              ? "pdf"
              : "image",
        });
      })
      .catch(() => setPreview(null));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.id, item.version, mimeType, reauthenticationToken, spaceId, visual]);
  return preview?.kind === "image" ? (
    <img className="size-full object-cover" src={preview.url} alt="" />
  ) : preview?.kind === "pdf" ? (
    <object
      className="pointer-events-none size-full bg-white"
      data={preview.url}
      type="application/pdf"
      aria-label={`PDF thumbnail for ${item.display_name}`}
    />
  ) : (
    <File size={30} />
  );
}

export function buildLibraryAssetStack(
  kind: LibraryAssetStack["kind"],
  items: SpaceLibraryItem[],
): LibraryAssetStackInput | null {
  if (kind === "live_photo") {
    if (items.length !== 2) return null;
    const still = items.find((item) => libraryItemMIME(item).startsWith("image/"));
    const motion = items.find((item) => libraryItemMIME(item).startsWith("video/"));
    if (!still || !motion) return null;
    return {
      kind,
      title: "",
      cover_item_id: still.id,
      motion_item_id: motion.id,
      members: [
        { item_id: still.id, role: "still", position: 0 },
        { item_id: motion.id, role: "motion", position: 1 },
      ],
    };
  }
  if (kind === "raw_pair") {
    if (items.length !== 2) return null;
    const raw = items.find((item) => isLibraryRAW(item.file.original_filename));
    const rendered = items.find(
      (item) => item.id !== raw?.id && libraryItemMIME(item).startsWith("image/"),
    );
    if (!raw || !rendered) return null;
    return {
      kind,
      title: "",
      cover_item_id: rendered.id,
      members: [
        { item_id: rendered.id, role: "alternate", position: 0 },
        { item_id: raw.id, role: "raw", position: 1 },
      ],
    };
  }
  if (
    items.length < 2 ||
    items.length > 100 ||
    items.some((item) => !libraryItemMIME(item).startsWith("image/"))
  )
    return null;
  return {
    kind,
    title: "",
    cover_item_id: items[0].id,
    members: items.map((item, position) => ({
      item_id: item.id,
      role: "burst_frame" as const,
      position,
    })),
  };
}

export function detectUploadedAssetStacks(items: SpaceLibraryItem[]): LibraryAssetStackInput[] {
  const result: LibraryAssetStackInput[] = [];
  const byStem = new Map<string, SpaceLibraryItem[]>();
  const bursts = new Map<string, SpaceLibraryItem[]>();
  for (const item of items) {
    const filename = item.file.original_filename;
    const stem = filename.replace(/\.[^.]+$/, "").toLocaleLowerCase();
    byStem.set(stem, [...(byStem.get(stem) ?? []), item]);
    const burstMatch = filename
      .replace(/\.[^.]+$/, "")
      .match(/^(.*?)[_-]burst[_-]?(?:\d+)(?:[_-](?:cover|key))?$/i);
    if (burstMatch) {
      const key = burstMatch[1].toLocaleLowerCase();
      bursts.set(key, [...(bursts.get(key) ?? []), item]);
    }
  }
  for (const grouped of byStem.values()) {
    const live = buildLibraryAssetStack("live_photo", grouped);
    if (live) result.push(live);
    const rawPair = buildLibraryAssetStack("raw_pair", grouped);
    if (rawPair) result.push(rawPair);
  }
  for (const grouped of bursts.values()) {
    const burst = buildLibraryAssetStack("burst", grouped);
    if (burst) result.push(burst);
  }
  return result;
}

export function libraryItemMIME(item: SpaceLibraryItem): string {
  const metadataMIME = String(
    item.file.intrinsic_metadata.server_detected_mime_type ??
      item.file.intrinsic_metadata.client_declared_mime_type ??
      "",
  )
    .split(";")[0]
    .toLocaleLowerCase();
  if (metadataMIME && metadataMIME !== "application/octet-stream") return metadataMIME;
  const extension = item.file.original_filename.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (
    ["bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"].includes(extension)
  )
    return `image/${extension === "jpg" ? "jpeg" : extension === "tif" ? "tiff" : extension}`;
  if (["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"].includes(extension))
    return `video/${extension === "mov" ? "quicktime" : extension === "m4v" ? "mp4" : extension}`;
  if (["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"].includes(extension))
    return `audio/${extension === "mp3" ? "mpeg" : extension}`;
  return "application/octet-stream";
}

export function libraryFileTypeLabel(item: SpaceLibraryItem): string {
  const mime = libraryItemMIME(item);
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/"))
    return mime
      .slice(6)
      .replace("jpeg", "JPEG")
      .replace("png", "PNG")
      .replace("webp", "WebP")
      .toUpperCase();
  if (mime.startsWith("video/")) return mime.slice(6).replace("quicktime", "MOV").toUpperCase();
  if (mime.startsWith("audio/")) return mime.slice(6).replace("mpeg", "MP3").toUpperCase();
  const extension = item.file.original_filename.split(".").pop()?.trim();
  return extension ? extension.toUpperCase() : "File";
}

export function activeSensitiveGrant(grant?: { token: string; expiresAt: string }): string {
  return grant && new Date(grant.expiresAt).getTime() > Date.now() ? grant.token : "";
}

function isLibraryRAW(filename: string): boolean {
  return /\.(?:dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|x3f)$/i.test(filename);
}

export function AlbumCover({ spaceId, itemId }: { spaceId: string; itemId?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = true;
    let objectUrl = "";
    setUrl("");
    if (!itemId)
      return () => {
        current = false;
      };
    void spacesApi
      .libraryPreview(spaceId, itemId)
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(""));
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, spaceId]);
  return (
    <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted text-muted-foreground">
      {url ? (
        <img className="size-full object-cover" src={url} alt="" />
      ) : (
        <LibraryIcon size={26} />
      )}
    </span>
  );
}

export function LibraryFacetGroup({
  label,
  facets,
  onSelect,
}: {
  label: string;
  facets: LibrarySearchFacets["tags"];
  onSelect: (facet: LibrarySearchFacets["tags"][number]) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="mr-0.5 text-[10px] font-semibold capitalize text-muted-foreground">
        {label}
      </span>
      {facets.slice(0, 6).map((facet) => (
        <Button
          size="sm"
          variant="outline"
          type="button"
          key={`${facet.value}:${facet.label}`}
          onClick={() => onSelect(facet)}
        >
          {facet.label}
          <span className="text-muted-foreground">{facet.count}</span>
        </Button>
      ))}
    </div>
  );
}

export function libraryUtilityIcon(value: string): LucideIcon {
  if (value === "featured") return Sparkles;
  if (value === "recently-edited") return SlidersHorizontal;
  if (value === "recently-shared") return MessagesSquare;
  if (value === "screenshots") return ImageIcon;
  if (value === "handwriting") return Pencil;
  if (value === "illustrations") return Sparkles;
  if (value === "documents" || value === "receipts" || value === "qr-codes") return File;
  return History;
}

export function LibraryCollectionCard({
  icon: Icon,
  label,
  count,
  disabled = false,
  pinned = false,
  onClick,
  onTogglePin,
  onMoveEarlier,
  onMoveLater,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  disabled?: boolean;
  pinned?: boolean;
  onClick?: () => void;
  onTogglePin?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
}) {
  const canEdit = useContext(LibraryCanEditContext);
  return (
    <article className="group relative overflow-hidden rounded-xl bg-card shadow-xs inset-ring-1 inset-ring-foreground/10">
      <Button
        className="block w-full border-0 bg-transparent p-4 text-left disabled:opacity-40"
        type="button"
        disabled={disabled}
        onClick={onClick}
      >
        <Icon size={22} />
        <p className="mb-0 mt-3 truncate text-xs font-medium">{label}</p>
        <p className="mb-0 mt-1 text-[10px] text-muted-foreground">{count} items</p>
      </Button>
      {canEdit && onTogglePin && !disabled ? (
        <Button
          className={`absolute right-2 top-2 grid size-7 place-items-center rounded-lg border-0 ${pinned ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          type="button"
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin collection"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
        >
          <Pin size={13} fill={pinned ? "currentColor" : "none"} />
        </Button>
      ) : null}
      {canEdit && (onMoveEarlier || onMoveLater) ? (
        <span className="absolute bottom-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {onMoveEarlier ? (
            <Button
              className="grid size-6 place-items-center rounded-md border-0 bg-muted text-muted-foreground"
              type="button"
              onClick={onMoveEarlier}
              title="Move earlier"
              aria-label={`Move ${label} earlier`}
            >
              <ChevronLeft size={12} />
            </Button>
          ) : null}
          {onMoveLater ? (
            <Button
              className="grid size-6 place-items-center rounded-md border-0 bg-muted text-muted-foreground"
              type="button"
              onClick={onMoveLater}
              title="Move later"
              aria-label={`Move ${label} later`}
            >
              <ChevronRight size={12} />
            </Button>
          ) : null}
        </span>
      ) : null}
    </article>
  );
}

export function LibraryMapView({
  points,
  onBack,
  onSelect,
}: {
  points: LibraryMapPoint[];
  onBack: () => void;
  onSelect: (point: LibraryMapPoint) => void;
}) {
  return (
    <div className="mb-6">
      <Button
        className="mb-4 border-0 bg-transparent p-0 text-xs text-muted-foreground"
        type="button"
        onClick={onBack}
      >
        ← Collections
      </Button>
      <div className="overflow-hidden rounded-xl bg-[linear-gradient(145deg,#10222c,#111922_60%,#18232d)] p-3 shadow-xs inset-ring-1 inset-ring-white/10">
        <svg
          className="block aspect-[2/1] w-full"
          viewBox="0 0 1000 500"
          role="img"
          aria-label={`Map showing ${points.length} saved locations`}
        >
          <defs>
            <radialGradient id="misty-map-point" cx="35%" cy="30%">
              <stop offset="0" stopColor="#fff" />
              <stop offset="0.25" stopColor="#b7d8ff" />
              <stop offset="1" stopColor="#5b78ff" />
            </radialGradient>
          </defs>
          {[125, 250, 375].map((y) => (
            <line
              key={`latitude-${y}`}
              x1="0"
              x2="1000"
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,.08)"
              strokeWidth="1"
            />
          ))}
          {[125, 250, 375, 500, 625, 750, 875].map((x) => (
            <line
              key={`longitude-${x}`}
              x1={x}
              x2={x}
              y1="0"
              y2="500"
              stroke="rgba(255,255,255,.08)"
              strokeWidth="1"
            />
          ))}
          <path
            d="M65 110L145 68 236 83 276 136 247 180 194 188 167 239 112 225 89 173Z M253 251L313 267 340 333 319 423 272 452 238 376Z M430 93L506 65 568 92 552 128 594 151 573 201 516 194 488 238 448 221 421 165Z M558 236L620 249 660 316 630 410 574 430 537 352Z M590 83L697 62 814 93 877 135 853 183 779 172 740 216 681 199 637 153Z M807 327L875 302 932 336 916 394 848 408 805 371Z"
            fill="rgba(129,167,151,.22)"
            stroke="rgba(190,220,205,.25)"
            strokeWidth="2"
          />
          {points.map((point) => {
            const x = ((point.longitude + 180) / 360) * 1000;
            const y = ((90 - point.latitude) / 180) * 500;
            const radius = Math.min(18, 7 + Math.log2(point.item_count + 1) * 2);
            return (
              <g
                className="cursor-pointer outline-none"
                role="button"
                tabIndex={0}
                aria-label={`${point.name}, ${point.item_count} items`}
                key={point.id}
                transform={`translate(${x} ${y})`}
                onClick={() => onSelect(point)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(point);
                }}
              >
                <circle r={radius + 5} fill="rgba(83,120,255,.18)" />
                <circle
                  r={radius}
                  fill="url(#misty-map-point)"
                  stroke="rgba(255,255,255,.8)"
                  strokeWidth="2"
                />
                <text x="0" y="4" textAnchor="middle" fill="#08101a" fontSize="10" fontWeight="700">
                  {point.item_count}
                </text>
                <title>{point.name}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {points.slice(0, 12).map((point) => (
          <Button
            className="rounded-xl border-0 bg-muted/40 p-3 text-left shadow-none hover:bg-muted/65"
            type="button"
            key={point.id}
            onClick={() => onSelect(point)}
          >
            <p className="m-0 truncate text-xs font-medium">{point.name}</p>
            <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
              {point.item_count} items · {point.latitude.toFixed(2)}, {point.longitude.toFixed(2)}
            </p>
          </Button>
        ))}
      </div>
    </div>
  );
}

export function LibraryDiscoveryCard({
  spaceId,
  group,
  fallbackIcon: Icon,
  pinned = false,
  onTogglePin,
  onClick,
}: {
  spaceId: string;
  group: LibraryDiscoveryGroup;
  fallbackIcon: LucideIcon;
  pinned?: boolean;
  onTogglePin?: () => void;
  onClick: () => void;
}) {
  const canEdit = useContext(LibraryCanEditContext);
  return (
    <article className="group relative overflow-hidden rounded-xl bg-card shadow-xs inset-ring-1 inset-ring-foreground/10">
      <Button
        className="block w-full border-0 bg-transparent p-0 text-left"
        type="button"
        onClick={onClick}
      >
        <span className="relative block">
          <AlbumCover spaceId={spaceId} itemId={group.cover_item_id} />
          <span className="absolute left-3 top-3 grid size-8 place-items-center rounded-lg bg-black/55 text-white backdrop-blur">
            <Icon size={16} />
          </span>
        </span>
        <span className="block p-3">
          <span className="block truncate text-xs font-medium">{group.title}</span>
          <span className="mt-1 block truncate text-[10px] text-muted-foreground">
            {group.subtitle}
          </span>
        </span>
      </Button>
      {canEdit && onTogglePin ? (
        <Button
          className={`absolute right-3 top-3 grid size-8 place-items-center rounded-lg border-0 backdrop-blur ${pinned ? "bg-white text-black" : "bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
          type="button"
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin collection"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${group.title}`}
        >
          <Pin size={14} fill={pinned ? "currentColor" : "none"} />
        </Button>
      ) : null}
    </article>
  );
}

export function LibrarySelect({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const selectedValue = value || "__none__";
  return (
    <Select
      value={selectedValue}
      onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id || "__none__"} key={id || "__none__"}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
