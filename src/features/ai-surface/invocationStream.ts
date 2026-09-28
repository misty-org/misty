import type { AiInvocationEvent } from "./types";
import { parseRetryAfter } from "@/api/client/errors";

type StreamHandlers = { onEvent(event: AiInvocationEvent): void };
const terminalEvents = new Set([
  "invocation.completed",
  "invocation.failed",
  "invocation.canceled",
]);

/** Resume the same invocation after a transport failure; never submit the task again. */
export async function readInvocationStream(
  connect: (lastEventId: string, signal: AbortSignal) => Promise<Response>,
  signal: AbortSignal,
  handlers: StreamHandlers,
  retryDelay = 750,
  idleTimeout = 45_000,
): Promise<void> {
  let lastEventId = "";
  const delivered = new Set<string>();
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let retryable = true;
    let serverDelay = 0;
    const connection = new AbortController();
    const abortConnection = () => connection.abort();
    signal.addEventListener("abort", abortConnection, { once: true });
    try {
      const response = await streamOperationDeadline(
        connect(lastEventId, connection.signal).then((response) => {
          if (connection.signal.aborted) {
            void response.body?.cancel().catch(() => undefined);
            throw new DOMException("Stream stopped", "AbortError");
          }
          return response;
        }),
        signal,
        idleTimeout,
      );
      if (!response.ok || !response.body) {
        serverDelay = parseRetryAfter(response.headers.get("Retry-After")) ?? 0;
        retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw new Error(`Misty could not open the response stream (${response.status}).`);
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const processBuffer = (final = false): boolean => {
        if (final && buffer.trim() && !buffer.endsWith("\n\n")) {
          buffer += "\n\n";
        }
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = block.split("\n");
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) {
            let event: AiInvocationEvent;
            try {
              event = JSON.parse(data) as AiInvocationEvent;
              if (!event || typeof event.type !== "string") throw new Error("Invalid event");
            } catch {
              retryable = false;
              throw new Error("Misty returned an invalid response event. Please try again.");
            }
            const id =
              lines
                .find((line) => line.startsWith("id:"))
                ?.slice(3)
                .trim() || event.id;
            if (!id || !delivered.has(id)) {
              handlers.onEvent(event);
              if (id) {
                delivered.add(id);
                lastEventId = id;
              }
            }
            if (terminalEvents.has(event.type)) return true;
          }
          boundary = buffer.indexOf("\n\n");
        }
        return false;
      };
      while (!signal.aborted) {
        // Server heartbeats every 15s. Reconnect a dead transport, never time out
        // a live task or replay its actions. Abort also releases a pending read.
        const chunk = await streamOperationDeadline(reader.read(), signal, idleTimeout);
        if (chunk.done) {
          buffer += decoder.decode();
          buffer = buffer.replace(/\r\n/g, "\n");
          if (processBuffer(true)) return;
          throw new Error("Misty’s response was interrupted. Please try again.");
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        // Normalize after buffering: CRLF may span two network chunks.
        buffer = buffer.replace(/\r\n/g, "\n");
        if (processBuffer(false)) return;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (!retryable || attempt === 2) throw error;
    } finally {
      connection.abort();
      signal.removeEventListener("abort", abortConnection);
      // A broken underlying source must not prevent cancellation/reconnection.
      void reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(serverDelay, retryDelay * (attempt + 1)));
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}

async function streamOperationDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeout: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        cancel = () => reject(new DOMException("Stream stopped", "AbortError"));
        if (signal.aborted) return cancel();
        signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(
          () =>
            reject(new Error("Misty’s response stream stopped sending updates. Please reconnect.")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
