import { clientMetadata } from "@/services/telemetry/metadata";
import { redactRecord } from "@/services/telemetry/redaction";
import { readClientDebugEvents } from "@/shared/platform/clientDebug";

export interface SupportBundle {
  schema_version: 1;
  generated_at: string;
  notice: string;
  client: Record<string, unknown>;
  events: Record<string, unknown>[];
}

export async function buildSupportBundle(): Promise<SupportBundle> {
  const metadata = await clientMetadata();
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    notice:
      "Created locally at the user's request. Review this file before sharing it with Misty support.",
    client: redactRecord(metadata as unknown as Record<string, unknown>),
    events: readClientDebugEvents().map((event) =>
      redactRecord(event as unknown as Record<string, unknown>),
    ),
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
