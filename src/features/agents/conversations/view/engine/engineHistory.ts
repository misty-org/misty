import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../../personal/agentAccount";

/** One session in an engine's own history, as native code indexed it from the CLI's files. */
export interface EngineSession {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title: string;
  customTitle?: string | null;
  preview: string;
  updatedAt?: number | null;
  messageCount: number;
}

interface EngineSearchHit {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title: string;
  customTitle?: string | null;
  updatedAt?: number | null;
  snippet: Array<{ text: string; marked: boolean }>;
}

export const listEngineSessions = () => invoke<EngineSession[]>("engine_history_list");

export const searchEngineSessions = (query: string) =>
  invoke<{ hits: EngineSearchHit[]; hasMore: boolean }>("engine_history_search", {
    query,
    limit: 50,
  });

/** Renames a session, written back where the engine keeps its own title. */
export const renameEngineSession = (engine: string, sessionId: string, title: string) =>
  invoke<void>("engine_history_rename", { engine, sessionId, title });

/** Points a chat at a session, so its next turn resumes it. */
export const resumeEngineSession = (
  conversation: string,
  session: { engine: string; sessionId: string; workspacePath: string },
) =>
  invoke<void>("engine_chat_resume", {
    account: agentAccountId(),
    conversation,
    engine: session.engine,
    folder: session.workspacePath,
    sessionId: session.sessionId,
  });

/** Sessions grouped by the folder they ran in, the folder with the newest session first. */
export function sessionsByFolder<T extends { workspacePath: string; updatedAt?: number | null }>(
  sessions: readonly T[],
): { path: string; sessions: T[] }[] {
  const groups = new Map<string, T[]>();
  const newest = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  for (const session of newest) {
    const group = groups.get(session.workspacePath);
    if (group) group.push(session);
    else groups.set(session.workspacePath, [session]);
  }
  return [...groups].map(([path, items]) => ({ path, sessions: items }));
}
