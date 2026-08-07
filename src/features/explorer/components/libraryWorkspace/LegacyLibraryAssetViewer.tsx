import { Input } from "@/ui";
import { Button } from "@/ui";
import { Badge } from "@/ui";
import { Dialog, DialogContent, DialogTitle } from "@/ui";
import { File, Loader2, Plus, Tag, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";
import { formatBytes, formatDate } from "../../utils/fileFormat";
import { DEFAULT_ASSET_TAG_LIMIT, tagsWithout, visibleAssetTags } from "../../utils/libraryTags";
import { DetailLabel, DetailStat, libraryAssetPreview } from "./LibraryDetailPrimitives";

export function LegacyLibraryAssetViewer(props: {
  asset: SmartLibraryAsset;
  rootPath: string;
  onClose: () => void;
  onSetTags: (tags: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [tagMutationPending, setTagMutationPending] = useState(false);
  const [tagMutationError, setTagMutationError] = useState<string | null>(null);
  const preview = libraryAssetPreview(props.asset, props.rootPath);
  const displayedTags = visibleAssetTags(props.asset.tags, tagsExpanded);
  const hiddenTagCount = Math.max(0, props.asset.tags.length - DEFAULT_ASSET_TAG_LIMIT);
  const tagControlsDisabled = tagMutationPending || pendingRemoval !== null;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingRemoval) {
        if (tagMutationPending) return;
        setPendingRemoval(null);
        setTagMutationError(null);
      } else {
        if (tagMutationPending) return;
        props.onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingRemoval, props.onClose, tagMutationPending]);
  const commit = async () => {
    const tag = value.trim();
    if (!tag) return;
    if (
      props.asset.tags.some(
        (candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      )
    ) {
      setTagMutationError(`“${tag}” is already on this file.`);
      return;
    }
    setTagMutationPending(true);
    setTagMutationError(null);
    try {
      await props.onSetTags([...props.asset.tags, tag]);
      setValue("");
      setAdding(false);
      setTagsExpanded(true);
    } catch (reason) {
      setTagMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTagMutationPending(false);
    }
  };
  const confirmRemoval = async () => {
    if (!pendingRemoval || tagMutationPending) return;
    setTagMutationPending(true);
    setTagMutationError(null);
    try {
      await props.onSetTags(tagsWithout(props.asset.tags, pendingRemoval));
      setPendingRemoval(null);
    } catch (reason) {
      setTagMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTagMutationPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !tagMutationPending) props.onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="grid h-[min(860px,calc(100vh-48px))] w-[calc(100%-2rem)] max-w-[1280px] min-h-0 grid-rows-[minmax(0,1fr)_minmax(280px,42%)] gap-0 overflow-hidden rounded-xl bg-charcoal-card p-0 text-cream lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.65fr)] lg:grid-rows-1 [&>[data-slot=dialog-close]]:hidden"
      >
        <div className="relative grid min-h-0 place-items-center overflow-hidden bg-charcoal-bg">
          {preview ? (
            <img
              className="size-full object-contain"
              src={preview}
              alt={props.asset.description || props.asset.name}
            />
          ) : (
            <div className="grid justify-items-center gap-3 text-cream-muted">
              <File size={72} strokeWidth={1.2} />
              <span>{props.asset.mimeType || "Open with the full reader"}</span>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled={tagMutationPending}
            aria-label="Close image viewer"
            className="absolute right-3 top-3 rounded-full disabled:cursor-wait"
            onClick={props.onClose}
          >
            <X size={18} />
          </Button>
        </div>
        <aside className="min-h-0 overflow-y-auto border-t border-charcoal-border p-5 lg:border-l lg:border-t-0">
          <div className="grid gap-5">
            <div className="min-w-0">
              <DialogTitle className="m-0 break-words text-xl font-bold tracking-[-0.02em]">
                {props.asset.name}
              </DialogTitle>
              <p className="m-0 mt-1 break-all text-xs text-cream-muted">
                {props.asset.relativePath}
              </p>
            </div>
            {props.asset.description ? (
              <div>
                <DetailLabel>Description</DetailLabel>
                <p className="m-0 mt-1 text-sm leading-6 text-cream-muted">
                  {props.asset.description}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-charcoal-card p-3 text-sm">
              <DetailStat
                label="Type"
                value={props.asset.assetKind || props.asset.mimeType || "File"}
              />
              <DetailStat label="Size" value={formatBytes(props.asset.sizeBytes)} />
              <DetailStat label="Modified" value={formatDate(props.asset.modifiedMs)} />
              <DetailStat
                label="Confidence"
                value={
                  props.asset.confidence === null
                    ? "—"
                    : `${Math.round(props.asset.confidence * 100)}%`
                }
              />
            </div>
            {props.asset.collections.length ? (
              <div>
                <DetailLabel>Collections</DetailLabel>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {props.asset.collections.map((collection) => (
                    <Badge key={collection} variant="secondary" className="rounded-full">
                      {collection}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <DetailLabel>Tags</DetailLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {displayedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-charcoal-border px-2.5 py-1 text-xs"
                  >
                    {tag}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={tagControlsDisabled}
                      aria-label={`Remove ${tag}`}
                      className="size-4 opacity-55 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
                      onClick={() => {
                        setPendingRemoval(tag);
                        setAdding(false);
                        setTagMutationError(null);
                      }}
                    >
                      <X size={11} />
                    </Button>
                  </span>
                ))}
                {hiddenTagCount > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tagControlsDisabled}
                    className="h-auto rounded-full border-dashed px-2.5 py-1 text-xs text-cream-muted"
                    aria-expanded={tagsExpanded}
                    onClick={() => setTagsExpanded((current) => !current)}
                  >
                    {tagsExpanded ? "Show fewer" : `+${hiddenTagCount} more`}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tagControlsDisabled}
                  className="h-auto rounded-full border-dashed px-2.5 py-1 text-xs"
                  onClick={() => {
                    setAdding(true);
                    setTagMutationError(null);
                  }}
                >
                  <Plus size={11} />
                  Tag
                </Button>
              </div>
              {pendingRemoval ? (
                <div
                  className="mt-3 rounded-lg border border-charcoal-active/25 bg-charcoal-active p-3"
                  role="alertdialog"
                  aria-labelledby="remove-tag-title"
                  aria-describedby="remove-tag-description"
                >
                  <strong className="block text-sm" id="remove-tag-title">
                    Remove “{pendingRemoval}”?
                  </strong>
                  <p
                    className="m-0 mt-1 text-xs leading-5 text-cream-muted"
                    id="remove-tag-description"
                  >
                    This removes the tag from {props.asset.name}. Other files will keep it.
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={tagMutationPending}
                      onClick={() => {
                        setPendingRemoval(null);
                        setTagMutationError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={tagMutationPending}
                      className="disabled:cursor-wait"
                      onClick={() => void confirmRemoval()}
                    >
                      {tagMutationPending ? <Loader2 className="animate-spin" size={13} /> : null}
                      {tagMutationPending ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {adding ? (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void commit();
                  }}
                >
                  <Input
                    autoFocus
                    disabled={tagControlsDisabled}
                    className="h-9 min-w-0 flex-1"
                    value={value}
                    maxLength={40}
                    placeholder="Add one tag"
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <Button size="sm" disabled={tagControlsDisabled} className="disabled:cursor-wait">
                    {tagMutationPending ? <Loader2 className="animate-spin" size={13} /> : null}Add
                  </Button>
                </form>
              ) : null}
              {tagMutationError ? (
                <p className="m-0 mt-2 text-xs leading-5 text-cream-bright" role="alert">
                  {tagMutationError}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}
