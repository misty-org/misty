// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useEffect, useRef, useState } from "react";
import { cliApi, listenCliUpdateProgress, type CliUpdatePlan } from "./api";
import { refreshCliStatus, useCliVersionStatus } from "./useCliVersionStatus";

/**
 * The install or update flow behind its confirm dialog: idle → planning → ready → running →
 * done or error. `begin` asks native code for the exact plan (the command and a manual
 * fallback); `confirm` runs it with a run id and streams that run's output into the dialog.
 *
 * The vendors' own installers (`plan.terminalCommand`) take the other branch, ready → terminal:
 * Misty never runs them hidden, so they run in a terminal inside the dialog, where the person
 * sees everything they do and can stop them. When the installer ends, the version is checked
 * again.
 *
 * The output listener exists only while a run is active.
 */

export type CliUpdateFlowStatus =
  "idle" | "planning" | "ready" | "running" | "terminal" | "done" | "error";

export interface CliUpdateLogLine {
  stream: "stdout" | "stderr";
  text: string;
}

/** Older lines are dropped so a chatty installer can't grow memory. */
const MAX_LOG_LINES = 200;

export interface CliUpdateFlowState {
  status: CliUpdateFlowStatus;
  plan: CliUpdatePlan | null;
  error: string | null;
  runId: string | null;
  logs: CliUpdateLogLine[];
  /** The terminal step: null while the installer runs, then whether it exited cleanly. */
  terminalOk: boolean | null;
}

const IDLE: CliUpdateFlowState = {
  status: "idle",
  plan: null,
  error: null,
  runId: null,
  logs: [],
  terminalOk: null,
};

export interface CliUpdateFlow {
  state: CliUpdateFlowState;
  /** Opens the dialog and asks for the plan. */
  begin: () => Promise<void>;
  /** Runs the planned command, or for a vendor installer moves to the terminal step. */
  confirm: () => Promise<void>;
  /** After a terminal install: checks the version again. */
  checkAgain: () => void;
  /** The terminal's installer ended; checks the version again. */
  terminalEnded: (ok: boolean) => void;
  /** Closes the dialog (not while a run is active). */
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

  // Listen only during a run; events carry the run id, so another run's lines never leak in.
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listenCliUpdateProgress((events) => {
      setState((cur) => {
        if (cur.runId === null) return cur;
        let logs = cur.logs;
        for (const event of events) {
          if (event.runId !== cur.runId) continue;
          if (event.phase === "stdout" || event.phase === "stderr") {
            logs = [...logs, { stream: event.phase, text: event.line ?? "" }];
          }
        }
        if (logs === cur.logs) return cur;
        if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
        return { ...cur, logs };
      });
    }).then((stop) => {
      // A teardown before the listener was ready stops it as soon as it is.
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
    if (state.plan?.terminalCommand) {
      setState((cur) => ({ ...cur, status: "terminal", error: null, terminalOk: null }));
      return;
    }
    const runId = `${engine}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setState((cur) => ({ ...cur, status: "running", runId, logs: [], error: null }));
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
  }, [engine, update, state.plan]);

  const checkAgain = useCallback(() => {
    void refreshCliStatus(engine);
    setState(IDLE);
  }, [engine]);

  const terminalEnded = useCallback(
    (ok: boolean) => {
      setState((cur) => (cur.status === "terminal" ? { ...cur, terminalOk: ok } : cur));
      void refreshCliStatus(engine);
      if (ok) callbacksRef.current?.onSuccess?.();
    },
    [engine],
  );

  const close = useCallback(() => {
    setState((cur) => (cur.status === "running" ? cur : IDLE));
  }, []);

  return { state, begin, confirm, checkAgain, terminalEnded, close };
}
