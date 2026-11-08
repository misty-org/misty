import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  prepare: vi.fn(),
  commit: vi.fn(),
  edit: vi.fn(),
  values: {} as Record<string, string | boolean>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/features/settings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDevicePreferences: { getState: () => ({ state: {}, edit: mocks.edit }) },
  resolveSetting: (_state: unknown, key: string) => ({ value: mocks.values[key] }),
}));
vi.mock("@/features/app-windows/profiles/profileWindow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  currentProfile: () => ({ id: "personal" }),
  firstProfileId: "personal",
}));
vi.mock("./native", () => ({
  extensionsNative: { prepare: mocks.prepare, commit: mocks.commit },
}));
import { follow } from "./followProfile";
import { parseInstallations, useExtensionsStore } from "./store";

const here = "ddkjiahejlhfcafbddmgiahcphecmpfh";
const elsewhere = "nngceckbapebfimnlniiiahkandclblb";
function installed(enabled: boolean) {
  return JSON.stringify([
    {
      id: here,
      guid: here,
      generation: "g",
      name: "Here",
      installed: true,
      enabled,
      privateAccess: false,
      agentAccess: false,
      permissions: ["storage"],
      hosts: [],
    },
  ]);
}

describe("following a profile's extensions", () => {
  beforeEach(() => {
    for (const mock of [mocks.invoke, mocks.prepare, mocks.commit, mocks.edit]) mock.mockReset();
    mocks.values = { "extensions.installations": installed(true) };
    mocks.edit.mockImplementation(async (key: string, value: string) => {
      mocks.values[key] = value;
    });
    useExtensionsStore.setState({ account: "local", fromProfile: [] });
  });

  it("offers an extension from the synced list and never installs it", async () => {
    mocks.invoke.mockResolvedValue({
      present: [{ id: elsewhere, name: "Elsewhere", enabled: true }],
      removed: [],
    });
    await follow();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(useExtensionsStore.getState().fromProfile).toEqual([
      { id: elsewhere, name: "Elsewhere" },
    ]);
  });

  it("ignores identities that fit no store", async () => {
    mocks.invoke.mockResolvedValue({
      present: [{ id: "../../somewhere", name: "Bad", enabled: true }],
      removed: [],
    });
    await follow();
    expect(useExtensionsStore.getState().fromProfile).toEqual([]);
  });

  it("switches what's already here on or off without touching its access", async () => {
    mocks.invoke.mockResolvedValue({
      present: [{ id: here, name: "Renamed by the server", enabled: false }],
      removed: [],
    });
    await follow();
    const [item] = parseInstallations(String(mocks.values["extensions.installations"]));
    expect(item).toMatchObject({ enabled: false, name: "Here", permissions: ["storage"] });
    expect(useExtensionsStore.getState().fromProfile).toEqual([]);
  });
});
