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

it("loads personal apps without a Space or manager permission", async()=>{
 mocks.manager=false;await useAppsStore.getState().load("one");
 expect(mocks.installations).toHaveBeenCalledWith();
 expect(useAppsStore.getState().installations).toHaveLength(1);
 await useAppsStore.getState().install(app);
 expect(mocks.install).toHaveBeenCalledWith("",app.id,1);
});
it("discards a previous account response",async()=>{
 const first=deferred<{apps:SpaceAppInstallation[]}>();mocks.installations.mockReturnValueOnce(first.promise);
 const load=useAppsStore.getState().load("one");await useAppsStore.getState().load("two");
 first.resolve({apps:[]});await load;expect(useAppsStore.getState().accountId).toBe("two");expect(useAppsStore.getState().installations).toHaveLength(1);
});
it("coalesces concurrent refreshes",async()=>{
 await Promise.all([useAppsStore.getState().load("one"),useAppsStore.getState().load("one")]);expect(mocks.installations).toHaveBeenCalledTimes(1);
});
it("clears stale authority after access is lost",async()=>{
 await useAppsStore.getState().load("one");mocks.installations.mockRejectedValueOnce(new ApiRequestError("forbidden",403));await useAppsStore.getState().load("one",true);expect(useAppsStore.getState().installations).toEqual([]);expect(useAppsStore.getState().ready).toBe(false);
});
it("does not reuse another account's local pin preference",async()=>{
 await useAppsStore.getState().load("one");await useAppsStore.getState().setPinned("journal",false);expect(useAppsStore.getState().installations[0].pinned).toBe(false);await useAppsStore.getState().load("two");expect(useAppsStore.getState().installations[0].pinned).toBe(true);
});
it("keeps installation identity stable during unchanged polling",async()=>{
 await useAppsStore.getState().load("one");const before=useAppsStore.getState().installations;await useAppsStore.getState().load("one",true);expect(useAppsStore.getState().installations).toBe(before);
});
it("rejects mutations after an account switch",async()=>{
 await useAppsStore.getState().load("one");const action=deferred<void>();mocks.install.mockReturnValueOnce(action.promise);const operation=useAppsStore.getState().install(app);await useAppsStore.getState().load("two");action.resolve();await expect(operation).rejects.toThrow("account changed");expect(useAppsStore.getState().accountId).toBe("two");
});
