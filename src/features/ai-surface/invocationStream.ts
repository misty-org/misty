import type { AiInvocationEvent } from "./types";

type StreamHandlers = { onEvent(event: AiInvocationEvent): void };
const terminalEvents = new Set([
  "invocation.completed",
  "invocation.failed",
  "invocation.canceled",
]);

/** Resume the same invocation after a transport failure; never submit the task again. */
export async function readInvocationStream(
  connect: (lastEventId: string) => Promise<Response>,
  signal: AbortSignal,
  handlers: StreamHandlers,
  retryDelay = 750,
): Promise<void> {
  let lastEventId = "";
  const delivered = new Set<string>();
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let retryable = true;
    try {
      const response = await connect(lastEventId);
      if (!response.ok || !response.body) {
        retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw new Error(`Misty could not open the response stream (${response.status}).`);
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Misty’s response was interrupted. Please try again.");
        buffer += decoder.decode(chunk.value, { stream: true });
        // Normalize after buffering: CRLF may span two network chunks.
        buffer = buffer.replace(/\r\n/g, "\n");
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
            if (terminalEvents.has(event.type)) return;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (!retryable || attempt === 2) throw error;
    } finally {
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, retryDelay * (attempt + 1));
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}
