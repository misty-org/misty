import { useCallback, useEffect, useRef, useState } from "react";
import type { MistyPluginContext } from "../plugins/types";

export type PluginJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number | null;
  message: string;
  outputPaths: string[];
  error?: string;
};

type StartResult = { ok?: boolean; jobId?: string; message?: string };

export function usePluginJob(context: MistyPluginContext) {
  const [job, setJob] = useState<PluginJob | null>(null);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const poll = useCallback(async (jobId: string) => {
    const result = await context.runHostCommand<PluginJob & { ok?: boolean }>("jobs.status", { jobId });
    if (result.ok === false || !result.id) {
      setJob((current) => current ? { ...current, status: "failed", error: result.message ?? "Could not read job status." } : current);
      return;
    }
    setJob(result);
    if (result.status === "queued" || result.status === "running") {
      timerRef.current = window.setTimeout(() => void poll(jobId), 650);
    }
  }, [context]);

  useEffect(() => clearTimer, [clearTimer]);

  const start = useCallback(async (command: string, payload: Record<string, unknown>) => {
    clearTimer();
    setStarting(true);
    const result = await context.runHostCommand<StartResult>(command, payload);
    setStarting(false);
    if (result.ok === false || !result.jobId) {
      setJob({ id: "", status: "failed", progress: null, message: result.message ?? "The job could not be started.", outputPaths: [], error: result.message });
      return false;
    }
    setJob({ id: result.jobId, status: "queued", progress: 0, message: result.message ?? "Queued…", outputPaths: [] });
    void poll(result.jobId);
    return true;
  }, [clearTimer, context, poll]);

  const cancel = useCallback(async () => {
    if (!job?.id) return;
    await context.runHostCommand("jobs.cancel", { jobId: job.id });
    clearTimer();
    setJob((current) => current ? { ...current, status: "cancelled", message: "Cancelled." } : current);
  }, [clearTimer, context, job?.id]);

  return {
    job,
    starting,
    running: starting || job?.status === "queued" || job?.status === "running",
    start,
    cancel,
    reset: () => { clearTimer(); setJob(null); },
  };
}
