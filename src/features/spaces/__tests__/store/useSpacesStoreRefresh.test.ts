import type { Space } from "@/services/spaces/dto/interfaces/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ snapshot: vi.fn(), members: vi.fn() }));

vi.mock("@/services/spaces/api", () => ({
  resolveSpacesApiBase: vi.fn(async () => "http://localhost:8081/api"),
  SpaceRequestError: class SpaceRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
      this.name = "SpaceRequestError";
    }
  },
  spacesApi: { snapshot: apiMocks.snapshot, members: apiMocks.members },
}));

import { SpaceRequestError } from "@/services/spaces/api";
import { resetSpacesAccountState, useSpacesStore } from "../../store/useSpacesStore";

describe("Spaces snapshot background refresh", () => {
  beforeEach(() => {
    resetSpacesAccountState();
    apiMocks.snapshot.mockReset();
    apiMocks.members.mockReset();
  });

  afterEach(() => resetSpacesAccountState());

  it("keeps the current snapshot available while a forced refresh is pending", async () => {
    const current = spaceFixture("Current Space");
    const refreshed = { ...current, name: "Refreshed Space" };
    let resolveSnapshot: (value: {
      spaces: Space[];
      invitations: never[];
      entitlements: null;
    }) => void = () => {};
    apiMocks.snapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    useSpacesStore.setState({ spaces: [current], snapshotReady: true, loading: false });

    const refresh = useSpacesStore.getState().load({ force: true });

    expect(useSpacesStore.getState()).toMatchObject({
      spaces: [current],
      snapshotReady: true,
      loading: true,
    });

    resolveSnapshot({ spaces: [refreshed], invitations: [], entitlements: null });
    await refresh;

    expect(useSpacesStore.getState()).toMatchObject({
      spaces: [refreshed],
      snapshotReady: true,
      loading: false,
    });
  });

  it("retains a rendered snapshot when background revalidation fails", async () => {
    const current = spaceFixture("Current Space");
    apiMocks.snapshot.mockRejectedValue(
      new SpaceRequestError("The refresh request was rejected.", 400, "invalid_request"),
    );
    useSpacesStore.setState({ spaces: [current], snapshotReady: true, loading: false });

    await useSpacesStore.getState().load({ force: true });

    expect(useSpacesStore.getState()).toMatchObject({
      spaces: [current],
      snapshotReady: true,
      loading: false,
      error: "The refresh request was rejected.",
    });
  });

  it("backs off automated forced refreshes after a server failure", async () => {
    apiMocks.snapshot.mockRejectedValue(
      new SpaceRequestError("The server could not load Spaces.", 500, "internal_error"),
    );

    await useSpacesStore.getState().load({ force: true });
    await useSpacesStore.getState().load({ force: true });

    expect(apiMocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale Space access request through one fresh snapshot", async () => {
    const current = spaceFixture("Current Space");
    const fallback = { ...spaceFixture("Misty"), id: "misty" };
    useSpacesStore.setState({
      spaces: [current],
      snapshotReady: true,
      loading: false,
      membersBySpace: { current: [] },
    });
    apiMocks.members.mockRejectedValue(
      new SpaceRequestError("You no longer have access to this Space.", 403, "forbidden"),
    );
    apiMocks.snapshot.mockResolvedValue({
      spaces: [fallback],
      invitations: [],
      entitlements: null,
    });

    await expect(useSpacesStore.getState().loadMembers("current")).resolves.toBeUndefined();

    expect(apiMocks.snapshot).toHaveBeenCalledTimes(1);
    expect(useSpacesStore.getState().spaces).toEqual([fallback]);
    expect(useSpacesStore.getState().membersBySpace.current).toBeUndefined();
  });
});

function spaceFixture(name: string): Space {
  return {
    id: "current",
    name,
    kind: "standard",
    owner_user_id: "owner",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    created_at: "2026-08-05T00:00:00Z",
    updated_at: "2026-08-05T00:00:00Z",
  };
}
