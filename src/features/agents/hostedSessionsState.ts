import { create } from "zustand";

/**
 * Browser sessions this computer runs for a request made on another of the
 * person's devices (docs/design/agents-on-devices/BRIEF.md). The asking device
 * signed a grant naming this one; the job worker checked it and this device's
 * own policy before calling here. Each session holds its own native lease,
 * signs the grant for its own tab, and ends on Stop here, when the request is
 * stopped, or after ten idle minutes.
 */
export interface HostedSession {
  taskId: string;
  conversationId: string;
  accountId: string;
  agentId: string;
  scopeId: string;
  viewId: string;
  /** Tabs this session's sub-agents opened; closed with it. */
  childViews: string[];
  /** The request currently using the session. */
  runId: string;
  lastUsed: number;
}

export const useHostedSessions = create<{ sessions: HostedSession[] }>(() => ({ sessions: [] }));

export const sessions = () => useHostedSessions.getState().sessions;
export const update = (next: HostedSession[]) => useHostedSessions.setState({ sessions: next });

export function hostedSessionForTask(taskId: string): HostedSession | undefined {
  return sessions().find((session) => session.taskId === taskId);
}

/** Marks a session in use when one of its tabs runs a job. */
export function touchHostedSession(scopeId: string, runId: string) {
  const session = sessions().find((item) => item.scopeId === scopeId);
  if (session)
    update(
      sessions().map((item) =>
        item === session ? { ...item, lastUsed: Date.now(), runId } : item,
      ),
    );
}

export function addHostedChildViews(taskId: string, views: string[]) {
  update(
    sessions().map((item) =>
      item.taskId === taskId ? { ...item, childViews: [...item.childViews, ...views] } : item,
    ),
  );
}
