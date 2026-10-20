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
  /** The scopes of the session's other tabs, whose jobs keep it in use too. */
  childScopes?: string[];
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

/** Marks a session in use when any of its tabs runs a job: a run working in its other tabs
 * is still using the session, which would otherwise idle out and close them mid-run. */
export function touchHostedSession(scopeId: string, runId: string) {
  const session = sessions().find((item) => item.scopeId === scopeId || item.childScopes?.includes(scopeId));
  if (session)
    update(
      sessions().map((item) =>
        item === session ? { ...item, lastUsed: Date.now(), runId } : item,
      ),
    );
}

/** Forgets one of a session's other tabs by its scope, returning the view to close. */
export function removeHostedChildTab(taskId: string, scopeId: string): string | undefined {
  const session = sessions().find((item) => item.taskId === taskId);
  const index = session?.childScopes?.indexOf(scopeId) ?? -1;
  const view = index >= 0 ? session?.childViews[index] : undefined;
  if (!session || !view) return undefined;
  update(
    sessions().map((item) =>
      item === session
        ? {
            ...item,
            childViews: item.childViews.filter((_, position) => position !== index),
            childScopes: (item.childScopes ?? []).filter((_, position) => position !== index),
          }
        : item,
    ),
  );
  return view;
}

export function addHostedChildViews(taskId: string, views: string[], scopes: string[] = []) {
  update(
    sessions().map((item) =>
      item.taskId === taskId
        ? { ...item, childViews: [...item.childViews, ...views], childScopes: [...(item.childScopes ?? []), ...scopes] }
        : item,
    ),
  );
}
