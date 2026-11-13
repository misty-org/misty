import { ApiRequestError, apiRequest } from "@/api/client";
import { LocalToolRejected, LocalToolUncertain, type LocalToolRequest } from "../host";

/**
 * A Space tool is the person using the app by hand, through the server's normal signed-in routes. The
 * server checks it like any other request of theirs. The words here are the ones these tools gave the
 * model when the server ran them, so a run sees the same answers.
 */
const NOT_COMPLETED = "Misty could not complete this tool call.";
export const NOT_ALLOWED = "This tool call is not allowed for the current run.";
export const BAD_SCHEMA = "The arguments do not match this tool's input schema.";
const BAD_VALUES = "The tool arguments are invalid.";
const MAY_HAVE_HAPPENED = "The action may have completed. Reconcile its outcome before retrying.";

/** A route's answer that nothing changed, with what it said, so a tool can word its own refusal. */
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
    case "drawing_conflict":
      return "The drawing changed since it was read. Call drawing_read again, then retry with its latest base_hash.";
    case "document_too_large":
      return "The drawing would exceed the collaboration document size limit. Apply a smaller scene or delete unused elements first.";
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

/** Any answer under 500 means nothing happened. Anything else on a write leaves it unknown. */
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

/** A request that changes nothing, or a repeat of it would be harmless: failing leaves no doubt. */
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

/** A request that changes something: a failure with no answer may still have taken effect. */
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

/** Runs a route and swaps the refusals the model can correct for words that say how. */
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
