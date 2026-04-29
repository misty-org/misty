import { readAccountSessionGeneration } from "@/features/auth";
import { useExplorerStore } from "@/features/file-explorer";
import { useSpacesStore } from "@/features/spaces";
import { spacesApi } from "@/services/spaces/api";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { CheckCircle2, Copy, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

type UploadStage =
  "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed" | "canceled";

interface AddToSpaceJob {
  id: string;
  path: string;
  name: string;
  stage: UploadStage;
  progress: number;
  error?: string;
}

export function AddFilesToSpaceDialog({
  open,
  paths,
  onOpenChange,
}: {
  open: boolean;
  paths: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { spaces, loading, load } = useSpacesStore(
    useShallow((state) => ({ spaces: state.spaces, loading: state.loading, load: state.load })),
  );
  const [spaceId, setSpaceId] = useState("");
  const [jobs, setJobs] = useState<AddToSpaceJob[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const eligibleSpaces = useMemo(
    () => spaces.filter((space) => space.permissions?.["library.upload"] !== false),
    [spaces],
  );
  const readyCount = jobs.filter((job) => job.stage === "ready").length;
  const failedCount = jobs.filter(
    (job) => job.stage === "failed" || job.stage === "canceled",
  ).length;
  const completed = jobs.length > 0 && readyCount + failedCount === jobs.length;
  const overallProgress = jobs.length
    ? (jobs.reduce((total, job) => total + jobProgress(job), 0) / jobs.length) * 100
    : 0;

  useEffect(() => {
    if (!open) return;
    setSpaceId("");
    setMessage("");
    setRunning(false);
    setJobs(
      paths.map((path, index) => ({
        id: `${index}:${path}`,
        path,
        name: fileName(path),
        stage: "queued",
        progress: 0,
      })),
    );
    void load();
  }, [load, open, paths]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const updateJob = (id: string, patch: Partial<AddToSpaceJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  };

  const upload = async () => {
    if (!spaceId || running) return;
    const accountGeneration = readAccountSessionGeneration();
    const pending = jobs.filter(
      (job) => job.stage === "queued" || job.stage === "failed" || job.stage === "canceled",
    );
    if (!pending.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setMessage("");
    setJobs((current) =>
      current.map((job) =>
        pending.some((candidate) => candidate.id === job.id)
          ? { ...job, stage: "queued", progress: 0, error: undefined }
          : job,
      ),
    );
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < pending.length && !controller.signal.aborted) {
        const job = pending[cursor++];
        try {
          await spacesApi.uploadLibraryPath(spaceId, job.path, "library", {
            signal: controller.signal,
            onStage: (stage) =>
              updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress) => updateJob(job.id, { progress }),
          });
          succeeded += 1;
          updateJob(job.id, { stage: "ready", progress: 1 });
        } catch (reason) {
          failed += 1;
          const canceled = reason instanceof DOMException && reason.name === "AbortError";
          updateJob(job.id, {
            stage: canceled ? "canceled" : "failed",
            error: canceled
              ? "Canceled"
              : reason instanceof Error
                ? reason.message
                : "Upload failed.",
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, () => worker()));
    if (accountGeneration !== readAccountSessionGeneration()) {
      controllerRef.current = null;
      setRunning(false);
      setSpaceId("");
      setJobs([]);
      setMessage("");
      return;
    }
    if (controller.signal.aborted) {
      setJobs((current) =>
        current.map((job) =>
          job.stage === "queued" ? { ...job, stage: "canceled", error: "Canceled" } : job,
        ),
      );
    }
    controllerRef.current = null;
    setRunning(false);
    const destination = eligibleSpaces.find((space) => space.id === spaceId)?.name ?? "the Space";
    const summary = controller.signal.aborted
      ? "Upload canceled. You can retry the unfinished files."
      : failed
        ? `${succeeded} added to ${destination}; ${failed} failed.`
        : `${succeeded} ${succeeded === 1 ? "copy" : "copies"} added to ${destination}.`;
    setMessage(summary);
    useExplorerStore
      .getState()
      .pushNotification(summary, failed || controller.signal.aborted ? "info" : "success", 5000);
    if (succeeded > 0) {
      window.dispatchEvent(
        new CustomEvent("misty:space-library-event", { detail: { space_id: spaceId } }),
      );
    }
  };

  const close = () => {
    if (running) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-48px))] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add copies to a Space</DialogTitle>
          <DialogDescription>
            Misty uploads copies to the selected Space Library. Your originals stay in Files and are
            never moved or replaced. This beta supports files up to 128 MB each.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-hidden">
          <label className="grid gap-2 text-xs font-medium text-cream-muted">
            Destination Space
            <Select
              value={spaceId}
              onValueChange={setSpaceId}
              disabled={running || loading || readyCount > 0}
            >
              <SelectTrigger aria-label="Destination Space">
                <SelectValue placeholder={loading ? "Loading Spaces…" : "Choose a Space"} />
              </SelectTrigger>
              <SelectContent>
                {eligibleSpaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name}
                    {space.is_shared ? " · Shared" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {!loading && eligibleSpaces.length === 0 ? (
            <p className="m-0 rounded-md bg-charcoal-card px-3 py-2 text-sm text-cream-muted">
              You do not have upload permission in any Space.
            </p>
          ) : null}

          <section className="grid min-h-0 gap-2" aria-label="Files to copy">
            <div className="flex items-center justify-between gap-3 text-xs text-cream-muted">
              <span>
                {jobs.length} {jobs.length === 1 ? "file" : "files"}
              </span>
              {running || completed ? <span>{Math.round(overallProgress)}%</span> : null}
            </div>
            <Progress value={overallProgress} aria-label="Overall upload progress" />
            <div className="misty-transient-scrollbar grid max-h-64 gap-1.5 overflow-y-auto pr-1">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-charcoal-card px-2.5 py-2"
                >
                  <JobIcon stage={job.stage} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium" title={job.path}>
                      {job.name}
                    </span>
                    <span className="block truncate text-[10px] text-cream-muted">
                      {job.error || stageLabel(job.stage)}
                    </span>
                  </span>
                  {job.stage === "ready" ? <Badge variant="outline">Added</Badge> : null}
                </div>
              ))}
            </div>
          </section>

          {message ? (
            <p
              className="m-0 rounded-md bg-charcoal-card px-3 py-2 text-xs text-cream-muted"
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {running ? (
            <Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>
              Cancel upload
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={close}>
              {completed && failedCount === 0 ? "Done" : "Cancel"}
            </Button>
          )}
          {completed && readyCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                navigate(`/spaces/${encodeURIComponent(spaceId)}/library`);
              }}
            >
              View Library
            </Button>
          ) : null}
          {!running && failedCount > 0 ? (
            <Button type="button" disabled={!spaceId} onClick={() => void upload()}>
              Retry failed
            </Button>
          ) : !completed ? (
            <Button
              type="button"
              disabled={!spaceId || running || jobs.length === 0}
              onClick={() => void upload()}
            >
              <Copy size={14} /> Add copies
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobIcon({ stage }: { stage: UploadStage }) {
  if (stage === "ready") return <CheckCircle2 className="size-4 text-sage-fg" />;
  if (stage === "failed" || stage === "canceled")
    return <XCircle className="size-4 text-cream-bright" />;
  if (stage !== "queued") return <LoaderCircle className="size-4 animate-spin text-cream-bright" />;
  return <Copy className="size-4 text-cream-muted" />;
}

function jobProgress(job: AddToSpaceJob): number {
  if (job.stage === "ready") return 1;
  if (job.stage === "failed" || job.stage === "canceled") return job.progress;
  if (job.stage === "reading") return 0.08;
  if (job.stage === "hashing") return 0.16;
  if (job.stage === "finalizing") return 0.95;
  if (job.stage === "uploading") return 0.18 + job.progress * 0.72;
  return 0;
}

function stageLabel(stage: UploadStage): string {
  if (stage === "reading") return "Reading local file…";
  if (stage === "hashing") return "Checking file…";
  if (stage === "uploading") return "Uploading copy…";
  if (stage === "finalizing") return "Adding to Library…";
  if (stage === "ready") return "Added to Library";
  if (stage === "failed") return "Upload failed";
  if (stage === "canceled") return "Canceled";
  return "Ready to copy";
}

function fileName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "file"
  );
}
