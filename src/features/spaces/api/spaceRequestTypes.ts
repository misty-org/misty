export type SpaceRequestInit = RequestInit & {
  allowWhileReferenceOnly?: boolean;
  /** A GET that paints the saved copy first, when there is one; the fresh response follows. */
  onCached?: (value: never) => void;
};

export type SpaceRequest = <T = void>(path: string, init?: SpaceRequestInit) => Promise<T>;
