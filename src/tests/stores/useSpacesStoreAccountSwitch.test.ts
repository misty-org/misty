import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSpacesAccountState, useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { Space, SpaceMember, SpacesSnapshot } from "@/models/interfaces/features/spaces/types";

const apiMocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  members: vi.fn(),
  inbox: vi.fn(),
}));

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  resolveSpacesApiBase: vi.fn(async () => "http://localhost:8081/api"),
  spacesApi: {
    snapshot: apiMocks.snapshot,
    members: apiMocks.members,
    inbox: apiMocks.inbox,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const spaceA: Space = {
  id: "space-a",
  owner_user_id: "user-a",
  name: "Account A's Space",
  role: "owner",
  member_count: 1,
  pending_count: 0,
  is_personal: true,
  is_shared: false,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
};

const memberA: SpaceMember = {
  space_id: "space-a",
  user_id: "user-a",
  name: "Account A",
  email: "a@example.com",
  role: "owner",
  joined_at: "2026-07-14T00:00:00Z",
  read_message_seq: 0,
};

function snapshotWith(spaces: Space[]): SpacesSnapshot {
  return {
    spaces,
    invitations: [],
    entitlements: {
      unlimited_spaces: true,
      unlimited_collaborators: true,
    },
    owner_storage: {
      used_bytes: 0,
      reserved_bytes: 0,
      limit_bytes: 2_000_000_000,
      remaining_bytes: 2_000_000_000,
      spaces: [],
    },
  };
}

describe("useSpacesStore account-switch race safety", () => {
  beforeEach(() => {
    apiMocks.snapshot.mockReset();
    apiMocks.members.mockReset();
    apiMocks.inbox.mockReset();
    resetSpacesAccountState();
  });

  it("discards a stale load() success that resolves after the account was switched", async () => {
    const first = deferred<SpacesSnapshot>();
    apiMocks.snapshot.mockReturnValueOnce(first.promise);

    const staleLoad = useSpacesStore.getState().load();
    resetSpacesAccountState(); // switch accounts while the request for A is still in flight
    first.resolve(snapshotWith([spaceA])); // A's response finally lands
    await staleLoad;

    // A's data must never reach the store once we've moved on from A's context.
    expect(useSpacesStore.getState().spaces).toEqual([]);
  });

  it("discards a stale load() error that resolves after the account was switched", async () => {
    const first = deferred<SpacesSnapshot>();
    apiMocks.snapshot.mockReturnValueOnce(first.promise);

    const staleLoad = useSpacesStore.getState().load();
    resetSpacesAccountState();
    first.reject(new Error("account A session expired"));
    await staleLoad;

    // A false negative for the new account, caused by A's stale failure, must not surface.
    expect(useSpacesStore.getState().error).toBeNull();
  });

  it("still applies a load() that started after the account switch", async () => {
    const second = deferred<SpacesSnapshot>();
    apiMocks.snapshot.mockReturnValueOnce(second.promise);

    resetSpacesAccountState();
    const freshLoad = useSpacesStore.getState().load();
    second.resolve(snapshotWith([spaceA]));
    await freshLoad;

    expect(useSpacesStore.getState().spaces).toEqual([spaceA]);
    expect(useSpacesStore.getState().loading).toBe(false);
  });

  it("puts the store into a loading state immediately on account switch rather than a false empty state", () => {
    useSpacesStore.setState({ spaces: [spaceA], loading: false, error: "some stale error" });

    resetSpacesAccountState();

    const state = useSpacesStore.getState();
    expect(state.spaces).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(true);
  });

  it("discards a stale loadMembers() response keyed to a space from the previous account", async () => {
    const first = deferred<{ members: SpaceMember[] }>();
    apiMocks.members.mockReturnValueOnce(first.promise);

    const staleLoad = useSpacesStore.getState().loadMembers("space-a");
    resetSpacesAccountState();
    first.resolve({ members: [memberA] });
    await staleLoad;

    expect(useSpacesStore.getState().membersBySpace["space-a"]).toBeUndefined();
  });

  it("does not surface a stale inbox error after the account changes", async () => {
    const first = deferred<{ items: never[] }>();
    apiMocks.inbox.mockReturnValue(first.promise);

    const staleLoad = useSpacesStore.getState().loadInbox();
    resetSpacesAccountState();
    first.reject(new Error("account A inbox failed"));
    await staleLoad;

    expect(useSpacesStore.getState().error).toBeNull();
  });
});
