export const accountScopeResetEvent = "misty:account-scope-reset";

export function notifyAccountScopeReset(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(accountScopeResetEvent));
}
