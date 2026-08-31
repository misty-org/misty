export interface ApiSessionProvider {
  isTransitioning: () => boolean;
  readGeneration: () => number;
  readToken: () => Promise<string | null>;
}

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

export function readApiAuthToken(): Promise<string | null> {
  return provider.readToken();
}
