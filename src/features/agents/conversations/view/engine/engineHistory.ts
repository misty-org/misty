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

/** Every session, after the engines' files are read again, so none started since is missed. */
export const rescanEngineSessions = () => invoke<EngineSession[]>("engine_history_rescan");

export const searchEngineSessions = (query: string) =>
  invoke<{ hits: EngineSearchHit[]; hasMore: boolean }>("engine_history_search", {
    query,
    limit: 50,
  });

/** One row of a session as native code parsed it from the engine's own file. */
export interface EngineHistoryMessage {
  seq: number;
  /** `user`, `assistant`, `tool` (its name in `text`) or the engine's reasoning. */
  role: string;
  text: string;
  ts?: string | null;
  path?: string;
  args?: unknown;
  result?: unknown;
  usage?: unknown;
  model?: string;
  durationMs?: number;
  /** A prompt's pictures, as data URLs. */
  images?: string[];
}

/** A session's messages, read from the engine's own file. */
export const readEngineSession = (engine: string, sessionId: string) =>
  invoke<EngineHistoryMessage[]>("engine_history_messages", { engine, sessionId });

/** The engine session a chat runs, if it has started one. */
export const readChatSession = (conversation: string) =>
  invoke<{ engine: string; sessionId: string } | null>("engine_chat_session", {
    account: agentAccountId(),
    conversation,
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
