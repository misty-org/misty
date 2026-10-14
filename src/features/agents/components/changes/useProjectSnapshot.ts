import { useEffect, useState } from "react";
import { useMistyStore } from "@/features/misty/useMistyStore";

type SnapshotState =
  | { state: "idle" }
  | { state: "saving"; spaceName?: string }
  | { state: "saved"; spaceName: string }
  | { state: "failed"; message: string };

const savedKey = "misty:agent-project-snapshots:v1";
const recentMs = 24 * 60 * 60 * 1000;
const inFlight = new Set<string>();

function savedRuns(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberRun(runId: string) {
  try {
    localStorage.setItem(savedKey, JSON.stringify([runId, ...savedRuns()].slice(0, 300)));
  } catch {
    /* Only avoids a second upload from this computer. */
  }
}

/**
 * After an agent changes a code project, a snapshot of the project goes to the
 * agent's Space so the Space keeps what it built. The folder stays local. Runs
 * older than a day are left alone, so opening old chats doesn't upload them.
 */
export function useProjectSnapshot(input: {
  conversationId?: string;
  scopeId?: string;
  runId?: string;
  createdAt?: number;
  changed: boolean;
}) {
  const agentId = useMistyStore(
    (state) => state.conversations.find((item) => item.id === input.conversationId)?.agentId,
  );
  const [status, setStatus] = useState<SnapshotState>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  const { conversationId, scopeId, runId, createdAt, changed } = input;
  useEffect(() => {
    if (!changed || !agentId || !scopeId || !runId || !createdAt) return;
    const manual = attempt > 0;
    if (!manual && (Date.now() - createdAt * 1000 > recentMs || savedRuns().includes(runId)))
      return;
    if (inFlight.has(runId)) return;
    inFlight.add(runId);
    let live = true;
    setStatus({ state: "saving" });
    import("../../agentArtifacts")
      .then(({ saveProjectSnapshot }) =>
        saveProjectSnapshot({ agentId, scopeId, runId, conversationId }),
      )
      .then(({ space }) => {
        rememberRun(runId);
        if (live) setStatus({ state: "saved", spaceName: space.name });
      })
      .catch((reason: unknown) => {
        if (live)
          setStatus({
            state: "failed",
            message:
              reason instanceof Error && reason.message.includes("100 MB")
                ? reason.message
                : "A snapshot couldn’t be saved to the agent’s Space.",
          });
      })
      .finally(() => inFlight.delete(runId));
    return () => {
      live = false;
    };
  }, [agentId, attempt, changed, conversationId, createdAt, runId, scopeId]);
  return { status, retry: () => setAttempt((value) => value + 1) };
}
