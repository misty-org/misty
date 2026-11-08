import { ErrorNotification } from "@/shared/ui";
import { redactText } from "./redaction";
import { createElement, useEffect } from "react";

interface SystemErrorInput {
  /** Background refresh and app diagnostics render nothing. */
  intent?: "background" | "user-action";
  title: string;
  onRetry?: () => void;
  error?: unknown;
  body?: string;
  scope: string;
}

interface SystemErrorDiagnostic {
  id: string;
  createdAt: string;
  title: string;
  body: string;
}

const maxDiagnostics = 50;
let diagnostics: SystemErrorDiagnostic[] = [];

/** Records an error for this session's support bundle; signing out clears it.
 * It never notifies; render action errors at their source. */
export function reportSystemError(input: SystemErrorInput): string {
  const body = systemErrorMessage(input.body?.trim() || input.error);
  const id = `system-error:${safeId(input.scope)}:${stableHash(`${input.title}\n${body}`)}`;
  diagnostics = [
    {
      id,
      createdAt: new Date().toISOString(),
      title: input.title,
      body,
    },
    ...diagnostics.filter((item) => item.id !== id),
  ].slice(0, maxDiagnostics);
  return id;
}

export function readSystemErrors(): readonly SystemErrorDiagnostic[] {
  return diagnostics;
}

export function clearSystemErrors(): void {
  diagnostics = [];
}

/** Foreground failures show as a notification; background reports stay renderless. */
export function SystemErrorNotice({
  intent,
  body,
  error,
  scope,
  title,
  onRetry,
}: SystemErrorInput) {
  const message = body?.trim() || systemErrorMessage(error);

  useEffect(() => {
    reportSystemError({ intent, body: message, scope, title });
  }, [intent, message, scope, title]);

  if (intent === "background") return null;
  return createElement(
    ErrorNotification,
    { message: `${title}. ${systemErrorMessage(message)}` },
    onRetry ? createElement("button", { type: "button", onClick: onRetry }, "Retry") : null,
  );
}

export function systemErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/could not reach|failed to fetch|network\s*error|load failed/i.test(message)) {
    return "Misty could not reach the service. Check your connection and try again.";
  }
  const scrubbed = redactText(message)
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
