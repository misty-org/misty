import { clientMetadata } from "@/telemetry/metadata";
import { redactRecord } from "@/telemetry/redaction";
import { readClientDebugEvents } from "@/shared/platform/clientDebug";

export interface SupportBundle {
  schema_version: 1;
  generated_at: string;
  notice: string;
  client: Record<string, unknown>;
  runtime: Record<string, unknown>;
  events: Record<string, unknown>[];
}

export async function buildSupportBundle(): Promise<SupportBundle> {
  const metadata = await clientMetadata();
  const events = readClientDebugEvents();
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    notice:
      "Created locally at the user's request. Review this file before sharing it with Misty support.",
    client: redactRecord(metadata as unknown as Record<string, unknown>),
    runtime: {
      online: typeof navigator === "undefined" ? null : navigator.onLine,
      route_family: routeFamily(),
      viewport_bucket: viewportBucket(),
      captured_event_count: events.length,
    },
    events: events.map((event) => redactRecord(event as unknown as Record<string, unknown>)),
  };
}

export async function downloadSupportBundle(): Promise<void> {
  const bundle = await buildSupportBundle();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `misty-support-${bundle.generated_at.slice(0, 10)}.json`;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function routeFamily(): string {
  if (typeof window === "undefined") return "unknown";
  const segment = window.location.pathname.split("/").filter(Boolean)[0] ?? "home";
  return new Set([
    "agents",
    "browser",
    "code",
    "files",
    "home",
    "inbox",
    "settings",
    "spaces",
    "terminal",
  ]).has(segment)
    ? segment
    : "other";
}

function viewportBucket(): string {
  if (typeof window === "undefined") return "unknown";
  if (window.innerWidth < 680) return "compact";
  if (window.innerWidth < 1100) return "medium";
  return "wide";
}
