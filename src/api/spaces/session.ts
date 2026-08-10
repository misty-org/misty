export interface SpaceSessionProvider {
  isTransitioning: () => boolean;
  readGeneration: () => number;
  readToken: () => Promise<string | null>;
}

let provider: SpaceSessionProvider = {
  isTransitioning: () => false,
  readGeneration: () => 0,
  readToken: async () => "",
};

export function configureSpaceSession(next: SpaceSessionProvider): void {
  provider = next;
}

export function isSpaceAccountSessionTransitioning(): boolean {
  return provider.isTransitioning();
}

export function readSpaceAccountGeneration(): number {
  return provider.readGeneration();
}

export function readSpaceAccountToken(): Promise<string | null> {
  return provider.readToken();
}
