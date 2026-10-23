import { ApiRequestError } from "@/api/client";
import { memoryApi, redactSecrets } from "@/features/recall";
import { type ScreenMemoryFrame } from "./native";

export type FrameResult = "saved" | "skipped" | "full";

function digest(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}:${hash}`;
}

/**
 * Keeps one captured window as a screen moment. Secrets are redacted first, and a window whose
 * text has not changed since the last one kept is not kept again.
 */
export function createFrameSaver() {
  const last = new Map<string, string>();
  return async (frame: ScreenMemoryFrame): Promise<FrameResult> => {
    const body = redactSecrets(frame.text.trim());
    if (!body) return "skipped";
    const key = `${frame.app}\u0000${frame.title}`;
    const seen = digest(body);
    if (last.get(key) === seen) return "skipped";
    try {
      await memoryApi.record({
        kind: "screen",
        title: (frame.title || frame.app).slice(0, 300),
        body,
        app: frame.app,
        window_title: frame.title.slice(0, 300),
        session_id: frame.sessionId,
        occurred_at: new Date(frame.capturedAtMs).toISOString(),
      });
      last.set(key, seen);
      return "saved";
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "memory_backlog_full") return "full";
      return "skipped";
    }
  };
}
