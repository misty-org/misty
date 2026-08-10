import type { useSmartLibraryStore } from "@/features/spaces/library";
import type { SmartLibraryAsset } from "@/native/contracts";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { Badge, Button, Progress } from "@/shared/ui";
import { AlertCircle, Cloud, File, Images, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function SmartLibraryFeature(props: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="grid gap-2 rounded-lg bg-charcoal-card p-4">
      <span className="text-cream-bright">{props.icon}</span>
      <strong className="text-sm font-medium">{props.title}</strong>
      <span className="text-xs leading-relaxed text-cream-muted">{props.text}</span>
    </div>
  );
}

export function SmartLibraryBusy(props: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="grid min-h-full place-items-center p-8">
      <div className="grid max-w-lg justify-items-center gap-4 text-center">
        <span className="grid size-14 animate-pulse place-items-center rounded-xl bg-charcoal-card text-cream-bright">
          {props.icon}
        </span>
        <h3 className="m-0 text-xl font-semibold">{props.title}</h3>
        <p className="m-0 text-sm leading-relaxed text-cream-muted">{props.text}</p>
      </div>
    </div>
  );
}

export function SmartLibraryError(props: { text: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-md bg-charcoal-active px-4 py-3 text-left text-sm text-cream-bright"
      role="alert"
    >
      <AlertCircle className="mt-0.5 shrink-0" size={17} />
      <span>{props.text}</span>
    </div>
  );
}

export function SmartLibraryPreflightView(props: {
  library: SmartLibrary;
  estimate: SmartLibraryEstimate;
  onTrySample: () => Promise<void>;
}) {
  const { preflight } = props.library;
  return (
    <div className="grid gap-6">
      <div>
        <h3 className="m-0 text-xl font-semibold tracking-tight">Ready to try a sample</h3>
        <p className="m-0 mt-2 text-sm text-cream-muted">
          The scan was local and free. Smart Library will analyze a representative sample before
          asking to continue.
        </p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-charcoal-border overflow-hidden rounded-lg bg-charcoal-card lg:grid-cols-5 lg:divide-y-0">
        <SmartLibraryMetric label="Discovered" value={preflight.totalImages} />
        <SmartLibraryMetric label="Supported" value={preflight.supportedImages} tone="good" />
        <SmartLibraryMetric
          label="Unsupported"
          value={preflight.unsupportedImages}
          tone={preflight.unsupportedImages ? "warn" : undefined}
        />
        <SmartLibraryMetric
          label="New / changed"
          value={preflight.newImages + preflight.changedImages}
        />
        <SmartLibraryMetric
          label="Pilot eligible"
          value={preflight.pilotCappedImages}
          suffix="max 500"
        />
      </div>
      {preflight.skippedFullOriginalImages > 0 ? (
        <SmartLibraryError
          text={`${preflight.skippedFullOriginalImages} cloud files were skipped because their provider would require downloading the full original. This pilot uploads previews or extracted metadata only.`}
        />
      ) : null}
      <div className="grid gap-4 rounded-lg bg-charcoal-active p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-cream-bright">
            25-file trial allowance
          </span>
          <strong className="text-lg font-semibold">Try the sample before using hosted AI</strong>
          <span className="text-sm leading-relaxed text-cream-muted">
            {preflight.sampleAssetIds.length} files selected across subfolders, formats, and dates.{" "}
            {formatEstimate(props.estimate ?? preflight.estimate)}
          </span>
        </div>
        <Button
          type="button"
          disabled={preflight.sampleAssetIds.length === 0}
          onClick={() => void props.onTrySample()}
        >
          <Sparkles size={17} />
          Try Sample
        </Button>
      </div>
      <div className="flex items-start gap-3 rounded-lg bg-charcoal-card p-4 text-sm leading-relaxed text-cream-muted">
        <ShieldAlert className="mt-0.5 shrink-0 text-cream-bright" size={18} />
        <span>
          Misty sends opaque asset IDs plus EXIF-stripped 384–512px previews for visual files, or
          bounded extracted text and metadata for other supported files. Paths and originals remain
          in the device catalog. Analysis and index upgrades always require approval.
        </span>
      </div>
    </div>
  );
}

export function SmartLibraryProgressView(props: {
  progress: SmartLibraryProgress;
  onRefresh: () => Promise<void>;
}) {
  const completed = props.progress?.successfulImages ?? 0;
  const failed = props.progress?.failedImages ?? 0;
  const queued = props.progress?.queuedImages ?? 0;
  const total = Math.max(1, completed + failed + queued);
  const percent = Math.round(((completed + failed) / total) * 100);
  return (
    <div className="grid min-h-[500px] place-items-center">
      <div className="grid w-full max-w-2xl gap-5 rounded-lg bg-charcoal-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="m-0 text-xl font-semibold">Smart Library is understanding your files</h3>
            <p className="m-0 mt-1 text-sm text-cream-muted">
              Keep Misty open while hosted AI processes each bounded batch.
            </p>
          </div>
          <span className="text-2xl font-semibold">{percent}%</span>
        </div>
        <Progress value={percent} />
        <div className="grid grid-cols-3 divide-x divide-charcoal-border overflow-hidden rounded-lg bg-charcoal-bg">
          <SmartLibraryMetric label="Completed" value={completed} tone="good" />
          <SmartLibraryMetric label="Remaining" value={queued} />
          <SmartLibraryMetric label="Failed" value={failed} tone={failed ? "warn" : undefined} />
        </div>
        <Button
          variant="outline"
          className="justify-self-end"
          type="button"
          onClick={() => void props.onRefresh()}
        >
          <RefreshCw size={15} />
          Refresh now
        </Button>
      </div>
    </div>
  );
}

export function SmartLibraryAssetGrid(props: {
  assets: SmartLibraryAsset[];
  library: SmartLibrary;
}) {
  if (props.assets.length === 0)
    return (
      <div className="grid min-h-52 place-items-center rounded-lg bg-charcoal-card text-sm text-cream-muted">
        No analyzed files are available for review.
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {props.assets.map((asset) => (
        <SmartLibraryAssetCard key={asset.assetId} asset={asset} library={props.library} />
      ))}
    </div>
  );
}

function SmartLibraryMetric(props: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "good" | "warn";
}) {
  const tone =
    props.tone === "good" ? "text-sage-fg" : props.tone === "warn" ? "text-sage-fg" : "text-cream";
  return (
    <div className="grid gap-1 p-4">
      <span className="text-xs font-medium text-cream-muted">{props.label}</span>
      <strong className={`text-xl font-semibold ${tone}`}>{props.value.toLocaleString()}</strong>
      {props.suffix ? <span className="text-[11px] text-cream-muted">{props.suffix}</span> : null}
    </div>
  );
}

function SmartLibraryAssetCard(props: { asset: SmartLibraryAsset; library: SmartLibrary }) {
  const visual = props.asset.assetKind === "image" || props.asset.mimeType.startsWith("image/");
  const source =
    visual && props.asset.sourceKind === "local"
      ? safeTauriAssetUrl(joinDevicePath(props.library.rootPath, props.asset.relativePath))
      : null;
  const confidence =
    props.asset.confidence === null ? null : Math.round(props.asset.confidence * 100);
  return (
    <article className="grid min-w-0 grid-rows-[180px_auto] overflow-hidden rounded-lg bg-charcoal-card">
      <div className="relative overflow-hidden bg-charcoal-card">
        {source ? (
          <img className="size-full object-cover" alt="" src={source} />
        ) : (
          <span className="grid size-full place-items-center gap-2 text-cream-muted">
            {visual && props.asset.sourceKind === "cloud" ? (
              <Cloud size={34} />
            ) : (
              <File size={34} />
            )}
            <small className="font-medium capitalize">
              {props.asset.assetKind || props.asset.extension.replace(/^\./, "") || "file"}
            </small>
          </span>
        )}
        {confidence !== null ? (
          <Badge className="absolute right-2 top-2" variant="secondary">
            {confidence}%
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-3 p-4">
        <div className="min-w-0">
          <strong className="block truncate text-sm font-medium" title={props.asset.relativePath}>
            {props.asset.name}
          </strong>
          <span className="mt-1 block line-clamp-3 text-xs leading-relaxed text-cream-muted">
            {props.asset.description || "No description generated."}
          </span>
        </div>
        {props.asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {props.asset.tags.slice(0, 6).map((tag) => (
              <Badge variant="secondary" className="font-normal" key={tag}>
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
        {props.asset.collections.length > 0 ? (
          <div className="flex items-center gap-2 text-[11px] font-medium text-cream-bright">
            <Images size={13} />
            <span className="truncate">{props.asset.collections.join(" · ")}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function formatEstimate(estimate: SmartLibraryEstimate): string {
  if (!estimate) return "Your estimated weekly hosted AI impact will be confirmed first.";
  return `${estimate.eligibleImages} files · about ${Math.ceil(estimate.hostedAIWeeklyRatio * 100)}% of weekly hosted AI usage.`;
}

function joinDevicePath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]+/, "")}`;
}

export type SmartLibrary = NonNullable<ReturnType<typeof useSmartLibraryStore.getState>["library"]>;

export type SmartLibraryEstimate = ReturnType<typeof useSmartLibraryStore.getState>["estimate"];

export type SmartLibraryProgress = ReturnType<typeof useSmartLibraryStore.getState>["progress"];
