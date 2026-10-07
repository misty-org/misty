/**
 * Google sign-in finishes in the browser, which hands Misty a one-time code
 * through a misty:// link (or the person types it). The server releases the
 * session only with that code, so a sign-in link sent to someone else cannot
 * sign its sender into their account. Codes are kept only while a sign-in is
 * waiting for one.
 */
let waiting = false;
let delivered = "";
const listeners = new Set<() => void>();

export function beginGoogleSignInCodeWait(): void {
  waiting = true;
  delivered = "";
}

export function endGoogleSignInCodeWait(): void {
  waiting = false;
  delivered = "";
  listeners.forEach((listener) => listener());
}

const codeAlphabet = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{10}$/;

/** The code as the server expects it, or "" when it cannot be one. */
export function normalizeGoogleSignInCode(code: string): string {
  const value = code.toUpperCase().replace(/[\s-]/g, "");
  return codeAlphabet.test(value) ? value : "";
}

/** Accepts a code only while a sign-in on this device is waiting for one. */
export function deliverGoogleSignInCode(code: string): boolean {
  const value = normalizeGoogleSignInCode(code);
  if (!waiting || !value) return false;
  delivered = value;
  listeners.forEach((listener) => listener());
  return true;
}

export function deliveredGoogleSignInCode(): string {
  return delivered;
}

/** Resolves when a code arrives or after `milliseconds`, whichever is first. */
export function waitForGoogleSignInCode(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      listeners.delete(done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = window.setTimeout(done, milliseconds);
    listeners.add(done);
    signal.addEventListener("abort", done, { once: true });
  });
}
