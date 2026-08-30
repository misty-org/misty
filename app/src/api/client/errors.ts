export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly responseText = "",
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function apiErrorMessage(code: string | undefined, fallback: string): string {
  const messages: Record<string, string> = {
    not_authenticated: "Your Misty session is unavailable. Sign out, then sign in again.",
    forbidden: "You do not have permission to perform that action.",
    not_found: "That Misty resource no longer exists.",
    account_changed: "Wait for the account switch to finish.",
    invalid_request: "Misty could not validate that request.",
    internal_error: "Misty could not complete that request. Try again in a moment.",
    mail_provider_mailbox_unavailable:
      "This Microsoft account has no Outlook mailbox. Use it in Files for OneDrive, or connect an Outlook.com or Microsoft 365 mailbox.",
    mail_provider_authorization_failed: "Reconnect this email account.",
    mail_capability_required: "Reconnect this account to grant email permissions.",
    reauthorization_required: "Reconnect this email account.",
    refresh_failed: "Session expired. Reconnect this email account.",
    mail_provider_rate_limited: "Email provider rate limit reached. Try again in a moment.",
    mail_provider_unavailable:
      "Email provider is temporarily unavailable. Try refreshing in a moment.",
    voice_unavailable: "Voice transcription is not available on this Misty server.",
    voice_recording_required: "Misty did not receive a voice recording.",
    voice_recording_too_large: "That voice recording is too large. Keep it under one minute.",
    voice_duration_invalid: "That voice recording could not be read. Please try again.",
    voice_transcription_failed: "Misty could not transcribe that recording. Please try again.",
    voice_speech_failed: "Misty could not generate speech for that response.",
    activepieces_not_configured: "This Misty server has not configured its automation service yet.",
    activepieces_not_connected: "The built-in automation engine is not ready yet.",
    activepieces_not_ready:
      "Misty could not prepare your automation workspace. Try again or ask the server operator to check Activity.",
    mcp_oauth_discovery_failed:
      "Misty could not reach its automation service. Ask the server operator to check Activepieces.",
  };
  return code && messages[code] ? messages[code] : fallback.trim() || "The Misty request failed.";
}

export function decodeApiError(text: string): { code?: string; message: string } {
  try {
    const decoded = JSON.parse(text) as { code?: unknown; message?: unknown; error?: unknown };
    const code = typeof decoded.code === "string" ? decoded.code : undefined;
    const message =
      typeof decoded.message === "string"
        ? decoded.message
        : typeof decoded.error === "string"
          ? decoded.error
          : "";
    return { code, message: apiErrorMessage(code, message) };
  } catch {
    return { message: apiErrorMessage(undefined, text) };
  }
}
