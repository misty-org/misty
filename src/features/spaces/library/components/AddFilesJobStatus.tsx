import { Spinner } from "@/shared/ui";
import { CheckCircle2, Copy, XCircle } from "lucide-react";

/** One local file being copied into a Space's Library, and how far it has got. */
export type UploadStage =
  "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed" | "canceled";

export interface AddToSpaceJob {
  id: string;
  path: string;
  name: string;
  stage: UploadStage;
  progress: number;
  error?: string;
}

export function JobIcon({ stage }: { stage: UploadStage }) {
  if (stage === "ready") return <CheckCircle2 className="size-4 text-cream-bright" />;
  if (stage === "failed" || stage === "canceled")
    return <XCircle className="size-4 text-cream-bright" />;
  if (stage !== "queued") return <Spinner label={false} className="text-cream-bright" />;
  return <Copy className="size-4 text-cream-muted" />;
}

export function jobProgress(job: AddToSpaceJob): number {
  if (job.stage === "ready") return 1;
  if (job.stage === "failed" || job.stage === "canceled") return job.progress;
  if (job.stage === "reading") return 0.08;
  if (job.stage === "hashing") return 0.16;
  if (job.stage === "finalizing") return 0.95;
  if (job.stage === "uploading") return 0.18 + job.progress * 0.72;
  return 0;
}

export function stageLabel(stage: UploadStage): string {
  if (stage === "reading") return "Reading local file…";
  if (stage === "hashing") return "Checking file…";
  if (stage === "uploading") return "Uploading copy…";
  if (stage === "finalizing") return "Adding to Library…";
  if (stage === "ready") return "Added to Library";
  if (stage === "failed") return "Upload failed";
  if (stage === "canceled") return "Canceled";
  return "Ready to copy";
}

export function fileName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "file"
  );
}
