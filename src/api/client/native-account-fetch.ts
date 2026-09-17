import { Channel, invoke } from "@tauri-apps/api/core";

export interface AccountRequestInit extends RequestInit {
  onUploadProgress?: (fraction: number) => void;
}

interface ResponseHead {
  status: number;
  headers: [string, string][];
  url: string;
}

/** Keeps cookie headers inside Rust, with streamed responses and cancellation. */
export async function nativeAccountFetch(
  input: RequestInfo | URL,
  init: AccountRequestInit,
  redirects = 0,
): Promise<Response> {
  const request = new Request(input, init);
  const signal = request.signal;
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invoke("auth_http_cancel", { requestId }).catch(() => undefined);
  };
  const hasBody = request.body !== null;
  const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
  const progress = new Channel<[number, number]>();
  progress.onmessage = ([sent, total]) => {
    if (!signal.aborted && total) init.onUploadProgress?.(sent / total);
  };
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    cancel();
    rejectAbort(new DOMException("Request aborted", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let head: ResponseHead;
  try {
    head = await Promise.race([
      invoke<ResponseHead>("auth_http_start", body, {
        headers: {
          "X-Misty-Request": encodeURIComponent(
            JSON.stringify({
              requestId,
              url: request.url,
              method: request.method,
              headers: Array.from(request.headers.entries()),
              hasBody,
              progress,
            }),
          ),
        },
      }),
      aborted,
    ]);
  } catch (error) {
    signal.removeEventListener("abort", onAbort);
    cancel();
    if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
    throw error;
  }
  const headers = new Headers(head.headers);
  if (signal.aborted) {
    cancel();
    signal.removeEventListener("abort", onAbort);
    throw new DOMException("Request aborted", "AbortError");
  }
  if (
    [301, 302, 303, 307, 308].includes(head.status) &&
    headers.has("Location") &&
    init.redirect !== "manual"
  ) {
    cancel();
    signal.removeEventListener("abort", onAbort);
    if (init.redirect === "error" || redirects >= 5) throw new Error("Unexpected Misty redirect.");
    const destination = new URL(headers.get("Location")!, request.url);
    if (destination.origin !== new URL(request.url).origin) {
      // Signed GET downloads may leave the API. Never forward account headers
      // or a credential-bearing request body to another origin.
      if (!["GET", "HEAD"].includes(request.method) || destination.protocol !== "https:")
        throw new Error("Unsafe Misty redirect.");
      return fetch(destination, { method: request.method, credentials: "omit", signal });
    }
    const redirectMethod =
      head.status === 303 || ([301, 302].includes(head.status) && request.method === "POST")
        ? "GET"
        : request.method;
    return nativeAccountFetch(
      destination,
      { ...init, method: redirectMethod, body: redirectMethod === "GET" ? undefined : init.body },
      redirects + 1,
    );
  }
  const noBody = request.method === "HEAD" || [204, 205, 304].includes(head.status);
  const stream = noBody
    ? null
    : new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await invoke<number[] | null>("auth_http_read", { requestId });
            if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
            if (chunk === null) {
              signal.removeEventListener("abort", onAbort);
              controller.close();
            } else controller.enqueue(new Uint8Array(chunk));
          } catch (error) {
            cancel();
            signal.removeEventListener("abort", onAbort);
            controller.error(error);
          }
        },
        cancel() {
          cancel();
          signal.removeEventListener("abort", onAbort);
        },
      });
  if (noBody) {
    cancel();
    signal.removeEventListener("abort", onAbort);
  }
  const response = new Response(stream, { status: head.status, headers });
  Object.defineProperty(response, "url", { value: head.url });
  return response;
}
