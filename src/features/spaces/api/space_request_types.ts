export type SpaceRequestInit = RequestInit & {
  allowWhileReferenceOnly?: boolean;
  onCached?: (value: never) => void;
};

export type SpaceRequest = <T = void>(path: string, init?: SpaceRequestInit) => Promise<T>;
