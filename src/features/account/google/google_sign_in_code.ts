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

function normalizeGoogleSignInCode(code: string): string {
  const value = code.toUpperCase().replace(/[\s-]/g, "");
  return codeAlphabet.test(value) ? value : "";
}

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
