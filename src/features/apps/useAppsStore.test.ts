import { ApiRequestError } from "@/api/client/errors";
import { beforeEach, expect, it, vi } from "vitest";
import type { OfficialApp, SpaceAppInstallation } from "@/api/apps";
import { useAppsStore } from "./useAppsStore";
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  installations: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  reorder: vi.fn(),
  generation: 0,
  manager: true,
}));
vi.mock("@/api/apps", () => ({ appsApi: mocks }));
vi.mock("@/features/spaces/core", () => ({
  useSpacesStore: {
    getState: () => ({
      spaces: ["family", "research"].map((id) => ({
        id,
        role: mocks.manager ? "owner" : "member",
        permissions: {},
      })),
    }),
  },
}));
vi.mock("@/api/client", () => ({
  readApiSessionGeneration: () => mocks.generation,
  assertStableApiSession: (value: number) => {
    if (value !== mocks.generation) throw new Error("account changed");
  },
}));
const app = { id: "journal", name: "Journal", version: "1", permission_version: 1 } as OfficialApp;
const installation = (spaceId: string): SpaceAppInstallation => ({
  app_id: "journal",
  space_id: spaceId,
  state: "installed",
  installed_version: "1",
  permission_version: 1,
  authority_generation: 1,
  granted_scopes: [],
  pin_rank: 1024,
  installed_at: "now",
  updated_at: "now",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.manager = true;
  mocks.generation = 0;
  useAppsStore.getState().reset();
  mocks.catalog.mockResolvedValue({ apps: [app] });
  mocks.installations.mockImplementation(async (id: string) => ({ apps: [installation(id)] }));
});
it("keeps the active Space independent of a late background Space response", async () => {
  const family = deferred<{ apps: SpaceAppInstallation[] }>();
  mocks.installations.mockImplementation((id: string) =>
    id === "family" ? family.promise : Promise.resolve({ apps: [installation(id)] }),
  );
  useAppsStore.getState().selectSpace("one", "family");
  useAppsStore.getState().selectSpace("one", "research");
  await vi.waitFor(() =>
    expect(useAppsStore.getState().installations[0]?.space_id).toBe("research"),
  );
  family.resolve({ apps: [installation("family")] });
  await vi.waitFor(() => expect(useAppsStore.getState().bySpace.family).toHaveLength(1));
  expect(useAppsStore.getState().installations[0].space_id).toBe("research");
});
it("adds to the Space without performing a personal installation or download", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  await useAppsStore.getState().install(app);
  expect(mocks.install).toHaveBeenCalledExactlyOnceWith("family", "journal", 1);
});
it("rejects a member's app changes", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  mocks.manager = false;
  await expect(useAppsStore.getState().uninstall("journal")).rejects.toThrow(/Space manager/);
  expect(mocks.uninstall).not.toHaveBeenCalled();
});
it("keeps pins personal and scoped to the Space", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  await useAppsStore.getState().setPinned("journal", false);
  expect(useAppsStore.getState().installations[0].pinned).toBe(false);
  useAppsStore.getState().selectSpace("one", "research");
  await useAppsStore.getState().load("one");
  expect(useAppsStore.getState().installations[0].pinned).toBe(true);
  expect(mocks.reorder).not.toHaveBeenCalled();
});
it("discards installation responses after an account switch", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  const pending = deferred<unknown>();
  mocks.install.mockReturnValue(pending.promise);
  const action = useAppsStore.getState().install(app);
  const rejection = expect(action).rejects.toThrow(/account changed/i);
  useAppsStore.getState().reset();
  mocks.generation++;
  useAppsStore.getState().selectSpace("two", "research");
  pending.resolve({});
  await rejection;
  expect(useAppsStore.getState().accountId).toBe("two");
  expect(useAppsStore.getState().bySpace.family).toBeUndefined();
});
it("withdraws cached local authority when a refresh cannot verify the Space", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  mocks.installations.mockRejectedValueOnce(new ApiRequestError("Access unavailable", 403));
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().bySpace.family).toBeUndefined();
  expect(useAppsStore.getState().installations).toHaveLength(0);
  expect(useAppsStore.getState().ready).toBe(false);
});
it("rechecks a change notification arriving during an older list request", async () => {
  const first = deferred<{ apps: SpaceAppInstallation[] }>();
  mocks.installations.mockReturnValueOnce(first.promise).mockResolvedValue({ apps: [] });
  useAppsStore.getState().selectSpace("one", "family");
  const refresh = useAppsStore.getState().invalidate("one", "family");
  first.resolve({ apps: [installation("family")] });
  await refresh;
  expect(mocks.installations).toHaveBeenCalledTimes(2);
  expect(useAppsStore.getState().bySpace.family).toEqual([]);
});

it("changes a chosen Space without switching the active Space", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  await useAppsStore.getState().setSpaceEnabled(app, "research", true);
  expect(mocks.install).toHaveBeenCalledExactlyOnceWith("research", "journal", 1);
  expect(useAppsStore.getState().spaceId).toBe("family");
  expect(useAppsStore.getState().installations[0].space_id).toBe("family");
  expect(useAppsStore.getState().bySpace.research[0].space_id).toBe("research");
});

it("checks authority on the target Space before changing its access", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  await expect(useAppsStore.getState().setSpaceEnabled(app, "unknown-space", true)).rejects.toThrow(
    /Space manager/,
  );
  expect(mocks.install).not.toHaveBeenCalled();
});

it("prefetches missing Space access once and reuses it across dropdowns", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  mocks.installations.mockClear();
  await Promise.all([
    useAppsStore.getState().prefetchSpaceAccess(),
    useAppsStore.getState().prefetchSpaceAccess(),
  ]);
  await useAppsStore.getState().prefetchSpaceAccess();
  expect(mocks.installations).toHaveBeenCalledExactlyOnceWith("research");
});
it("retains failed prefetch status until explicit retry", async () => {
  useAppsStore.setState({ accountId: "one", spaceId: "family" });
  mocks.installations.mockRejectedValue(new Error("offline"));
  await useAppsStore.getState().prefetchSpaceAccess();
  await useAppsStore.getState().prefetchSpaceAccess();
  expect(mocks.installations).toHaveBeenCalledTimes(2);
  mocks.installations.mockResolvedValue({ apps: [] });
  await useAppsStore.getState().prefetchSpaceAccess(true);
  expect(useAppsStore.getState().bySpace.research).toEqual([]);
  expect(useAppsStore.getState().bySpaceErrors.research).toBe("");
});

it("keeps installed apps visible when a background refresh fails", async () => {
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  const saved = useAppsStore.getState().installations;
  mocks.installations.mockRejectedValueOnce(new Error("Network unavailable"));
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().installations).toBe(saved);
  expect(useAppsStore.getState().bySpace.family).toBe(saved);
  expect(useAppsStore.getState().ready).toBe(true);
  expect(useAppsStore.getState().error).toBe("Network unavailable");
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().error).toBe("");
});

it("clears cached apps when the server explicitly revokes access", async () => {
  const { ApiRequestError } = await import("@/api/client/errors");
  useAppsStore.getState().selectSpace("one", "family");
  await useAppsStore.getState().load("one");
  mocks.installations.mockRejectedValueOnce(new ApiRequestError("Access denied", 403));
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().installations).toEqual([]);
  expect(useAppsStore.getState().bySpace.family).toBeUndefined();
});

it("shares concurrent polling and catalog requests across views and Spaces", async () => {
  const first = deferred<{ apps: SpaceAppInstallation[] }>();
  mocks.installations.mockReturnValueOnce(first.promise).mockResolvedValue({ apps: [] });
  const loads = Array.from({ length: 20 }, () =>
    useAppsStore.getState().load("one", true, "family"),
  );
  await useAppsStore.getState().load("one", true, "research");
  expect(mocks.catalog).toHaveBeenCalledTimes(1);
  expect(useAppsStore.getState().catalog).toEqual([app]);
  first.resolve({ apps: [] });
  await Promise.all(loads);
  expect(mocks.installations).toHaveBeenCalledTimes(2);
});
it("honors throttling cooldown even for forced refreshes", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    await useAppsStore.getState().load("one", true, "family");
    mocks.installations.mockRejectedValueOnce(
      new ApiRequestError("too many requests", 429, undefined, "", 120000),
    );
    await useAppsStore.getState().load("one", true, "family");
    expect(useAppsStore.getState().bySpace.family).toHaveLength(1);
    now.mockReturnValue(61000);
    await useAppsStore.getState().load("one", true, "family");
    expect(mocks.installations).toHaveBeenCalledTimes(2);
    now.mockReturnValue(121001);
    await useAppsStore.getState().load("one", true, "family");
    expect(mocks.installations).toHaveBeenCalledTimes(3);
  } finally {
    now.mockRestore();
  }
});

it("preserves unchanged catalog and Space references across authority polling", async () => {
  await useAppsStore.getState().load("one", true, "family");
  const before = useAppsStore.getState();
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().catalog).toBe(before.catalog);
  expect(useAppsStore.getState().bySpace.family).toBe(before.bySpace.family);
  mocks.installations.mockResolvedValue({
    apps: [{ ...installation("family"), authority_generation: 2 }],
  });
  await useAppsStore.getState().load("one", true, "family");
  expect(useAppsStore.getState().bySpace.family).not.toBe(before.bySpace.family);
  expect(useAppsStore.getState().bySpace.family[0].authority_generation).toBe(2);
});
