import { describe, expect, it } from "vitest";
import { packageSessionIdentity, retainSnapshot } from "./sessionState";
import type { OfficialAppPackageMountProps } from "./types";

const props = {
  user: { id: "account-1" },
  session: {
    appId: "planner",
    spaceId: "space-1",
    scopes: ["tasks.read", "tasks.write"],
    expiresAt: "2026-09-04",
  },
} as OfficialAppPackageMountProps;

describe("package session continuity", () => {
  it("preserves in-flight request identity during UI updates and session renewal", () => {
    expect(
      packageSessionIdentity({
        ...props,
        route: "/apps/planner/list",
        active: false,
        session: {
          ...props.session,
          expiresAt: "2026-09-05",
          scopes: ["tasks.write", "tasks.read"],
        },
      }),
    ).toBe(packageSessionIdentity(props));
  });
  it("invalidates requests when account, space, or granted access changes", () => {
    for (const next of [
      { ...props, user: { ...props.user, id: "account-2" } },
      { ...props, session: { ...props.session, spaceId: "space-2" } },
      { ...props, session: { ...props.session, scopes: ["tasks.read"] } },
    ])
      expect(packageSessionIdentity(next)).not.toBe(packageSessionIdentity(props));
  });
  it("keeps unchanged structured-cloned snapshots stable for React effects", () => {
    const space = { id: "space-1", permissions: { "tasks.read": true } };
    expect(retainSnapshot(space, structuredClone(space))).toBe(space);
    const updated = { ...space, permissions: { "tasks.read": false } };
    expect(retainSnapshot(space, updated)).toBe(updated);
  });
});
