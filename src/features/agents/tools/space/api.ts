import { ApiRequestError, apiRequest } from "@/api/client";
import { LocalToolRejected, LocalToolUncertain, type LocalToolRequest } from "../host";

const NOT_COMPLETED = "Misty could not complete this tool call.";
export const NOT_ALLOWED = "This tool call is not allowed for the current run.";
export const BAD_SCHEMA = "The arguments do not match this tool's input schema.";
const BAD_VALUES = "The tool arguments are invalid.";
const MAY_HAVE_HAPPENED = "The action may have completed. Reconcile its outcome before retrying.";

export class SpaceCallRefused extends LocalToolRejected {
  constructor(
    code: string,
    message: string,
    readonly status: number,
  ) {
    super(code, message);
  }
}

export const refuse = (message: string, code = "invalid_request") =>
  new LocalToolRejected(code, message);

function refusalMessage(error: ApiRequestError): string {
  switch (error.code) {
    case "account_closing":
    case "not_authenticated":
    case "account_changed":
      return error.message;
  }
  if (error.status === 403) return NOT_ALLOWED;
  if (error.status === 400) return BAD_VALUES;
  if (error.status === 429) return error.message;
  return NOT_COMPLETED;
}

function classify(error: unknown, writes: boolean): Error {
  if (error instanceof LocalToolRejected || error instanceof LocalToolUncertain) return error;
  const refused = error instanceof ApiRequestError && (error.status < 500 || isUnconfigured(error));
  if (refused) {
    return new SpaceCallRefused(
      error.code ?? "request_refused",
      refusalMessage(error),
      error.status,
    );
  }
  if (writes) return new LocalToolUncertain(MAY_HAVE_HAPPENED);
  return new LocalToolRejected("request_failed", NOT_COMPLETED);
}

const isUnconfigured = (error: ApiRequestError) => error.code === "collaboration_unconfigured";

const json = (body: unknown): RequestInit =>
  body === undefined ? {} : { body: JSON.stringify(body) };

export async function readRoute<T>(
  request: Pick<LocalToolRequest, "signal">,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  try {
    return await apiRequest<T>(path, { method, signal: request.signal, ...json(body) });
  } catch (error) {
    throw classify(error, false);
  }
}

export async function writeRoute<T = unknown>(
  request: Pick<LocalToolRequest, "signal">,
  path: string,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  try {
    return await apiRequest<T>(path, { method, signal: request.signal, headers, ...json(body) });
  } catch (error) {
    throw classify(error, true);
  }
}

export async function writeSteps<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw classify(error, true);
  }
}

export async function rewordRefusal<T>(
  call: () => Promise<T>,
  message: (refused: SpaceCallRefused) => string | undefined,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const replacement = error instanceof SpaceCallRefused ? message(error) : undefined;
    throw replacement === undefined ? error : refuse(replacement);
  }
}

export const spacePath = (spaceId: string, rest = "") =>
  `/spaces/${encodeURIComponent(spaceId)}${rest}`;

export const segment = encodeURIComponent;
