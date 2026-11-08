import { vi } from "vitest";
import { ApiRequestError, apiRequest } from "@/api/client";
import type { LocalToolHandler } from "../host";

/** Fakes the server for these tools' tests. Test files mock `@/api/client` so this reaches them. */
export interface Call {
  method: string;
  path: string;
  body?: unknown;
  headers?: HeadersInit;
}

type Answer = unknown | (() => unknown);

export function refusedWith(status: number, code?: string, message = "server words") {
  return new ApiRequestError(message, status, code);
}

/** Answers `METHOD /path` from a table; an Error in it is thrown. Returns the calls it saw. */
export function serve(routes: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  vi.mocked(apiRequest).mockImplementation((async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: init.headers });
    const key = `${method} ${path}`;
    if (!(key in routes)) throw new Error(`unexpected request: ${key}`);
    const answer = routes[key];
    const value = typeof answer === "function" ? (answer as () => unknown)() : answer;
    if (value instanceof Error) throw value;
    return value;
  }) as typeof apiRequest);
  return calls;
}

export const WORK = { id: "s1", name: "Work", is_default: false, is_shared: true, role: "member" };
export const HOME = { id: "s0", name: "Home", is_default: true, is_shared: false, role: "owner" };
export const SPACES = { "GET /spaces": { spaces: [WORK, HOME] } };

export const call = (
  handler: LocalToolHandler,
  input: Record<string, unknown>,
  ids = { runId: "run-1", callId: "call-1" },
) => handler({ ...ids, name: "test", input, signal: new AbortController().signal });
