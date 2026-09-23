export const accountScopeResetEvent = "misty:account-scope-reset";

export function notifyAccountScopeReset(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(accountScopeResetEvent));
}

export const accountScopeWillResetEvent = "misty:account-scope-will-reset";
export function notifyAccountScopeWillReset(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(accountScopeWillResetEvent));
}
