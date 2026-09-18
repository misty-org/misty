import { useEffect, useRef, useState } from "react";
import {
  connectMistyApp,
  type MistyAppSDK,
  type MistyFileScan,
} from "@misty/sdk";

/** Folder handles and job IDs are issued by the native host, never URL paths. */
export function useFolderScan() {
  const sdk = useRef<MistyAppSDK | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const currentJob = useRef("");
  const [jobId, setJobId] = useState("");
  const [folder, setFolder] = useState<{ handle: string; name: string } | null>(
    null,
  );
  const [job, setJob] = useState<MistyFileScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    try {
      sdk.current = connectMistyApp();
    } catch (error) {
      setError(String(error));
    }
    return () => {
      alive.current = false;
      generation.current += 1;
      if (currentJob.current)
        void sdk.current?.files
          .scanClose(currentJob.current)
          .catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const value = await sdk.current!.files.scanStatus(jobId);
        if (disposed) return;
        setJob(value);
        if (value.status === "running")
          timer = window.setTimeout(() => void poll(), 300);
      } catch (error) {
        if (disposed) return;
        setError(String(error));
        setJob(null);
        setFolder(null);
      }
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);
  const choose = async () => {
    if (!sdk.current || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await sdk.current.files.pickDirectory();
      if (!alive.current || request !== generation.current || !value) return;
      if (currentJob.current)
        await sdk.current.files.scanClose(currentJob.current);
      if (!alive.current || request !== generation.current) return;
      currentJob.current = "";
      setJobId("");
      setJob(null);
      setFolder(value);
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const start = async () => {
    if (!sdk.current || !folder || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      if (currentJob.current)
        await sdk.current.files.scanClose(currentJob.current);
      if (!alive.current || request !== generation.current) return;
      const value = await sdk.current.files.scanStart(folder.handle);
      if (!alive.current || request !== generation.current) {
        await sdk.current.files.scanClose(value.jobId);
        return;
      }
      currentJob.current = value.jobId;
      setJobId(value.jobId);
      setJob({ status: "running", message: "Scanning folder…", result: null });
    } catch (error) {
      if (alive.current) {
        setError(String(error));
        setJob(null);
        setFolder(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const cancel = async () => {
    if (!sdk.current || !currentJob.current) return;
    try {
      await sdk.current.files.scanCancel(currentJob.current);
      if (alive.current)
        setJob({
          status: "cancelled",
          message: "Scan cancelled.",
          result: null,
        });
    } catch (error) {
      if (alive.current) setError(String(error));
    }
  };
  return {
    folder,
    job,
    error,
    busy,
    choose,
    start,
    cancel,
    running: job?.status === "running",
  };
}
