import { useMediaSearchStore } from "@/features/files/search";
import { Button, Progress } from "@/shared/ui";
import { Film, Music, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { MediaIndexApprovalDialog, MediaIndexRemovalDialog } from "../MediaIndexDialogs";
import { LibraryEmpty } from "./LibraryDetailPrimitives";

export function MediaLibraryPanel() {
  const {
    loaded,
    loading,
    indexingAssetId,
    progress,
    error,
    snapshot,
    pendingApproval,
    scan,
    requestIndex,
    confirmIndex,
    cancelIndexApproval,
    pauseAsset,
    resumeAsset,
    removeAssetIndex,
    clearDeviceIndex,
  } = useMediaSearchStore(
    useShallow((state) => ({
      loaded: state.loaded,
      loading: state.loading,
      indexingAssetId: state.indexingAssetId,
      progress: state.progress,
      error: state.error,
      snapshot: state.snapshot,
      pendingApproval: state.pendingApproval,
      scan: state.scan,
      requestIndex: state.requestIndex,
      confirmIndex: state.confirmIndex,
      cancelIndexApproval: state.cancelIndexApproval,
      pauseAsset: state.pauseAsset,
      resumeAsset: state.resumeAsset,
      removeAssetIndex: state.removeAssetIndex,
      clearDeviceIndex: state.clearDeviceIndex,
    })),
  );
  const [removeTarget, setRemoveTarget] = useState<
    { kind: "asset"; assetId: string; name: string } | { kind: "device" } | null
  >(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) void scan();
  }, [loaded, scan]);
  const eligible =
    snapshot?.assets.filter(
      (asset) => asset.status !== "unsupported" && asset.indexedFingerprint !== asset.fingerprint,
    ) ?? [];
  const confirmRemoval = async () => {
    if (!removeTarget) return;
    setMutationPending(true);
    setMutationError(null);
    try {
      if (removeTarget.kind === "device") await clearDeviceIndex();
      else await removeAssetIndex(removeTarget.assetId);
      setRemoveTarget(null);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMutationPending(false);
    }
  };
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-bold">Media Search</h2>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-cream-muted">
            Search spoken words and visual scenes at exact timestamps. Misty indexes only{" "}
            {snapshot?.rootPath ?? "~/Movies"}; original files never leave your Mac.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !!indexingAssetId}
            onClick={() => void scan()}
          >
            {loading ? "Scanning…" : "Scan Movies"}
          </Button>
          {eligible.length ? (
            <Button
              type="button"
              size="sm"
              disabled={loading}
              onClick={() => requestIndex(eligible.map((asset) => asset.assetId))}
            >
              Analyze {eligible.length} {eligible.length === 1 ? "file" : "files"}
            </Button>
          ) : null}
          {snapshot?.assets.some((asset) => asset.indexedFingerprint === asset.fingerprint) ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!!indexingAssetId}
              onClick={() => setRemoveTarget({ kind: "device" })}
            >
              Clear index
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg bg-charcoal-card p-4 text-sm">
        <strong>Private, resumable preparation</strong>
        <p className="m-0 mt-1 text-cream-muted">
          Misty strips paths and metadata, sends 30-second compressed audio with up to four
          shot-aware 512px frames, and remembers progress across restarts. Each file is limited to
          120 minutes; total minutes are unlimited and always confirmed with a weekly hosted AI
          estimate. Failed or abandoned incomplete indexes are removed from the server after 30
          days.
        </p>
      </div>
      {!snapshot?.ffmpegAvailable && loaded ? (
        <p className="rounded-lg bg-sage-bg p-4 text-sm text-sage-fg">
          FFmpeg and FFprobe are required. Install FFmpeg, then scan again.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-charcoal-active p-4 text-sm text-cream-bright">{error}</p>
      ) : null}
      {snapshot?.assets.length ? (
        <div className="grid gap-2">
          {snapshot.assets.map((asset) => {
            const busy = indexingAssetId === asset.assetId;
            const current = asset.indexedFingerprint === asset.fingerprint;
            const resumable =
              (asset.status === "paused" || asset.status === "failed") &&
              asset.approvedFingerprint === asset.fingerprint;
            const percent = busy
              ? progress
              : mediaChunkCountForDisplay(asset.durationMs)
                ? asset.nextChunkIndex / mediaChunkCountForDisplay(asset.durationMs)
                : 0;
            return (
              <div
                key={asset.assetId}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-charcoal-border/60 p-3"
              >
                <span className="grid size-11 place-items-center rounded-md bg-charcoal-card">
                  {asset.mediaType === "audio" ? <Music size={20} /> : <Film size={20} />}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate">{asset.name}</strong>
                  <small className="block text-cream-muted">
                    {formatMediaDuration(asset.durationMs)} · {asset.mediaType} ·{" "}
                    {asset.status === "unsupported"
                      ? asset.failureCode === "duration_limit_exceeded"
                        ? "Over 120-minute limit"
                        : "Unsupported"
                      : busy
                        ? `Analyzing ${Math.round(percent * 100)}%`
                        : asset.status === "paused"
                          ? `Paused at ${Math.round(percent * 100)}%`
                          : asset.status === "failed"
                            ? `Needs attention · ${Math.round(percent * 100)}% saved`
                            : current
                              ? "Searchable"
                              : "Ready to analyze"}
                  </small>
                  {busy || asset.status === "paused" || asset.status === "failed" ? (
                    <Progress className="mt-2 h-1.5" value={Math.max(3, percent * 100)} />
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {busy ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void pauseAsset(asset.assetId)}
                    >
                      <Pause size={13} />
                      Pause
                    </Button>
                  ) : resumable ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void resumeAsset(asset.assetId)}
                    >
                      <Play size={13} />
                      Resume
                    </Button>
                  ) : !current && asset.status !== "unsupported" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => requestIndex([asset.assetId])}
                    >
                      Analyze
                    </Button>
                  ) : null}
                  {current ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove index for ${asset.name}`}
                      className="text-cream-muted hover:text-cream-bright"
                      onClick={() =>
                        setRemoveTarget({ kind: "asset", assetId: asset.assetId, name: asset.name })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : loaded && !loading ? (
        <LibraryEmpty
          title="No media found"
          text="Add an audio or video file to ~/Movies, then scan again."
        />
      ) : null}
      {pendingApproval ? (
        <MediaIndexApprovalDialog
          estimate={pendingApproval}
          pending={loading}
          onCancel={cancelIndexApproval}
          onConfirm={() => void confirmIndex()}
        />
      ) : null}
      {removeTarget ? (
        <MediaIndexRemovalDialog
          target={removeTarget}
          pending={mutationPending}
          error={mutationError}
          onCancel={() => {
            setRemoveTarget(null);
            setMutationError(null);
          }}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </div>
  );
}
export function formatMediaDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function mediaChunkCountForDisplay(durationMs: number) {
  const full = Math.floor(durationMs / 30_000);
  const remainder = durationMs % 30_000;
  return remainder === 0 ? full : remainder < 5_000 && full > 0 ? full : full + 1;
}
