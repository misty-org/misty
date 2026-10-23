import { readInvocationStream } from "./invocationStream";
import {
  apiRequestCredentials,
  httpRequest,
  readApiAuthToken,
  resolveRequiredApiBase,
} from "@/api/client";
import type { AiInvocationEvent } from "./types";

export function subscribeToAiInvocation(
  eventsUrl: string,
  handlers: {
    onEvent: (event: AiInvocationEvent) => void;
    onError: (error: Error) => void;
  },
): () => void {
  const controller = new AbortController();
  void streamAiInvocation(eventsUrl, controller.signal, handlers).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    handlers.onError(
      error instanceof Error ? error : new Error("The Misty response stream disconnected."),
    );
  });
  return () => controller.abort();
}

async function streamAiInvocation(
  eventsUrl: string,
  signal: AbortSignal,
  handlers: {
    onEvent: (event: AiInvocationEvent) => void;
    onError: (error: Error) => void;
  },
) {
  const [base, token] = await Promise.all([resolveRequiredApiBase(), readApiAuthToken()]);
  const headers = new Headers({ Accept: "text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  await readInvocationStream(
    (lastEventId, connectionSignal) => {
      if (lastEventId) headers.set("Last-Event-ID", lastEventId);
      return httpRequest(`${base}${eventsUrl}`, {
        method: "GET",
        credentials: apiRequestCredentials(),
        headers,
        signal: connectionSignal,
      });
    },
    signal,
    handlers,
  );
}
