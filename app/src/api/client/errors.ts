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
