export type SpaceRequestInit = RequestInit & { allowWhileReferenceOnly?: boolean };

export type SpaceRequest = <T = void>(path: string, init?: SpaceRequestInit) => Promise<T>;
