import { useEffect } from "react";
import type { ActivityTarget } from "./types";
import { useActivityStore } from "./useActivityStore";

const reportWindowMs = 5 * 60 * 1000;

export interface SystemErrorActivityInput {
  title: string;
  error?: unknown;
  body?: string;
  scope: string;
  accountId?: string;
  target?: ActivityTarget;
}

/** Sends unexpected operational failures to Activity instead of the work surface. */
export function reportSystemError(input: SystemErrorActivityInput): string | null {
  const body = systemErrorMessage(input.body?.trim() || input.error);
  const bucket = Math.floor(Date.now() / reportWindowMs);
  return useActivityStore.getState().ingestLocal({
    id: `system-error:${safeId(input.scope)}:${bucket}:${stableHash(`${input.title}\n${body}`)}`,
    accountId: input.accountId,
    kind: "failure",
    title: input.title,
    body,
    attention: true,
    target: input.target ?? { kind: "none" },
    notify: false,
  });
}

/** A renderless bridge for component-owned failures. */
export function SystemErrorActivity({
  accountId,
  body,
  error,
  scope,
  target,
  title,
}: SystemErrorActivityInput) {
  const message = body?.trim() || systemErrorMessage(error);

  useEffect(() => {
    reportSystemError({ accountId, body: message, scope, target, title });
  }, [accountId, message, scope, target, title]);

  return null;
}

export function systemErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/could not reach|failed to fetch|network\s*error|load failed/i.test(message)) {
    return "Misty could not reach the service. Check your connection and try again.";
  }
  const scrubbed = message
    .replace(/https?:\/\/\S+/gi, "the Misty service")
    .replace(/\bconnection_[a-z0-9-]+\b/gi, "the affected connection")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "the affected item")
    .trim();
  return scrubbed.slice(0, 240) || "The operation could not be completed.";
}

function safeId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:-]+/g, "-")
      .slice(0, 80) || "app"
  );
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
