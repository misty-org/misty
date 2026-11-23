// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useEffect, useRef, useState } from "react";
import { cliApi, listenCliUpdateProgress, type CliUpdatePlan } from "./api";
import { refreshCliStatus, useCliVersionStatus } from "./use_cli_version_status";

export type CliUpdateFlowStatus = "idle" | "planning" | "ready" | "running" | "done" | "error";

export type CliUpdateStep = "helper" | "engine";

export interface CliUpdateLogLine {
  stream: "stdout" | "stderr";
  text: string;
}

const MAX_LOG_LINES = 200;

export interface CliUpdateFlowState {
  status: CliUpdateFlowStatus;
  plan: CliUpdatePlan | null;
  error: string | null;
  runId: string | null;
  logs: CliUpdateLogLine[];
  step: CliUpdateStep | null;
}

const IDLE: CliUpdateFlowState = {
  status: "idle",
  plan: null,
  error: null,
  runId: null,
  logs: [],
  step: null,
};

export interface CliUpdateFlow {
  state: CliUpdateFlowState;
  begin: () => Promise<void>;
  confirm: () => Promise<void>;
  checkAgain: () => void;
  close: () => void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useCliUpdateFlow(
  engine: string,
  callbacks?: { onSuccess?: () => void; onError?: (message: string) => void },
): CliUpdateFlow {
  const { update } = useCliVersionStatus(engine);
  const [state, setState] = useState<CliUpdateFlowState>(IDLE);
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listenCliUpdateProgress((events) => {
      setState((cur) => {
        if (cur.runId === null) return cur;
        let logs = cur.logs;
        let step = cur.step;
        for (const event of events) {
          if (event.runId !== cur.runId) continue;
          if (event.phase === "stdout" || event.phase === "stderr") {
            logs = [...logs, { stream: event.phase, text: event.line ?? "" }];
          } else if (
            event.phase === "step" &&
            (event.line === "helper" || event.line === "engine")
          ) {
            step = event.line;
          }
        }
        if (logs === cur.logs && step === cur.step) return cur;
        if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
        return { ...cur, logs, step };
      });
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [running]);

  const begin = useCallback(async () => {
    setState({ ...IDLE, status: "planning" });
    try {
      const plan = await cliApi.updatePlan(engine);
      setState({ ...IDLE, status: "ready", plan });
    } catch (e) {
      const message = errorText(e);
      setState({ ...IDLE, status: "error", error: message });
      callbacksRef.current?.onError?.(message);
    }
  }, [engine]);

  const confirm = useCallback(async () => {
    const runId = `${engine}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setState((cur) => ({
      ...cur,
      status: "running",
      runId,
      logs: [],
      error: null,
      step: cur.plan?.needsHelper ? "helper" : "engine",
    }));
    try {
      await update(runId);
    } catch (e) {
      const message = errorText(e);
      setState((cur) => (cur.runId === runId ? { ...cur, status: "error", error: message } : cur));
      callbacksRef.current?.onError?.(message);
      return;
    }
    setState((cur) => (cur.runId === runId ? { ...cur, status: "done" } : cur));
    callbacksRef.current?.onSuccess?.();
  }, [engine, update]);

  const checkAgain = useCallback(() => {
    void refreshCliStatus(engine);
    setState(IDLE);
  }, [engine]);

  const close = useCallback(() => {
    setState((cur) => (cur.status === "running" ? cur : IDLE));
  }, []);

  return { state, begin, confirm, checkAgain, close };
}
