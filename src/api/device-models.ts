import { invoke } from "@tauri-apps/api/core";
import { ApiRequestError } from "@/api/client/errors";

type DeviceModelCall =
  | "cleanup"
  | "voice-transcription"
  | "screen-model"
  | "refine-point"
  | "extract"
  | "embed"
  | "day-summary"
  | "voice-notes"
  | "transcribe-diarized"
  | "model-test"
  | "follow-up";

/**
 * One model call on the agent runtime on this computer, with this device's own models and keys
 * (docs/agents/runtime.md). The server is never asked. Failures carry the runtime's code,
 * such as `model_key_needed`, like a server error would.
 */
export async function deviceModelCall<T>(
  name: DeviceModelCall,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const call = invoke<{ status: number; body: unknown }>("agent_runtime_call", { name, body });
  const reply = await (signal
    ? Promise.race([
        call,
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      ])
    : call);
  if (reply.status >= 200 && reply.status < 300) return reply.body as T;
  const failure = (reply.body ?? {}) as { code?: string; message?: string };
  throw new ApiRequestError(
    failure.message || "The model could not answer. Try again.",
    reply.status,
    failure.code,
  );
}
