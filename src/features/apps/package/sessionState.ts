import type { OfficialAppPackageMountProps } from "./types";

/** UI updates and token renewal must not invalidate requests already in flight. */
export function packageSessionIdentity(props: OfficialAppPackageMountProps): string {
  return JSON.stringify([
    props.user.id,
    props.session.appId,
    props.session.spaceId,
    [...props.session.scopes].sort(),
  ]);
}

export function retainSnapshot<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
