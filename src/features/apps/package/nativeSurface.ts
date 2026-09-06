import "./nativeSurface.css";

/** Native UI is a host-owned service; the package never receives native IPC. */
export function registerNativeSurfacePackage(appId: string): void {
  const parameters = new URL(window.location.href).searchParams;
  const instanceId = parameters.get("mistyAppInstance") ?? "";
  if (window.parent === window || parameters.get("mistyAppId") !== appId || !instanceId) return;
  let requested = false;
  let requestId = "";
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.protocol !== 2) return;
    if (
      message.type === "misty:app-rpc-response" &&
      message.requestId === requestId &&
      !message.ok
    ) {
      window.parent.postMessage(
        {
          type: "misty:app-error",
          protocol: 2,
          appId,
          instanceId,
          message: message.error?.message || "The native App service is unavailable.",
        },
        "*",
      );
    }
    if (
      requested ||
      message.type !== "misty:app-host-update" ||
      message.appId !== appId ||
      message.instanceId !== instanceId
    )
      return;
    requested = true;
    requestId = crypto.randomUUID();
    window.parent.postMessage(
      { type: "misty:app-rpc", protocol: 2, requestId, method: "native.surface.open", params: {} },
      "*",
    );
  });
  window.parent.postMessage({ type: "misty:app-ready", protocol: 2, appId, instanceId }, "*");
}
