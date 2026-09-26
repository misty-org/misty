export interface ApiSessionProvider {
  isTransitioning: () => boolean;
  readGeneration: () => number;
  readToken: (path?: string) => Promise<string | null>;
  requestCredentials?: () => RequestCredentials;
  /** True only when it is known that no account is signed in. */
  isSignedOut?: () => boolean;
}

export const apiSessionInvalidEvent = "misty:account-session-invalid";

let provider: ApiSessionProvider = {
  isTransitioning: () => false,
  readGeneration: () => 0,
  readToken: async () => "",
};

export function configureApiSession(next: ApiSessionProvider): void {
  provider = next;
}

export function isApiSessionTransitioning(): boolean {
  return provider.isTransitioning();
}

export function readApiSessionGeneration(): number {
  return provider.readGeneration();
}

export function readApiAuthToken(path?: string): Promise<string | null> {
  return provider.readToken(path);
}

export function isApiSignedOut(): boolean {
  return provider.isSignedOut?.() ?? false;
}

export function apiRequestCredentials(): RequestCredentials {
  return provider.requestCredentials?.() ?? "include";
}

export function notifyApiSessionInvalid(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(apiSessionInvalidEvent));
}
