export function callEncryptionSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof (window as { RTCRtpScriptTransform?: unknown }).RTCRtpScriptTransform !== "undefined")
    return true;
  return (
    typeof window.RTCRtpSender !== "undefined" &&
    typeof (window.RTCRtpSender.prototype as { createEncodedStreams?: unknown })
      .createEncodedStreams !== "undefined"
  );
}
