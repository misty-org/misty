import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCustomBangs } from "./browserSearchEngine";
import { configureDeviceBangs, refreshSpaceSearch, useSpaceSearchStore } from "./spaceSearch";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const jira = { trigger: "jira", name: "Jira", url: "https://jira.example/search?q=%s" };
const wiki = { trigger: "wiki", name: "Team wiki", url: "https://wiki.example/?q=%s" };

afterEach(() => {
  invoke.mockReset();
  useSpaceSearchStore.setState({ space: null, deviceBangsRaw: "[]" });
});

describe("search settings as Space data", () => {
  it("uses the window's Space's bangs instead of the device's", async () => {
    invoke.mockResolvedValue({ spaceId: "space-a", engine: "google", engines: [], bangs: [jira] });
    configureDeviceBangs(JSON.stringify([wiki]));
    await refreshSpaceSearch();
    expect(invoke).toHaveBeenCalledWith("browser_space_search");
    expect(browserCustomBangs()).toEqual([jira]);
  });

  it("falls back to the device's own bangs while no Space vault is open", async () => {
    invoke.mockResolvedValue(null);
    configureDeviceBangs(JSON.stringify([wiki]));
    await refreshSpaceSearch();
    expect(useSpaceSearchStore.getState().space).toBeNull();
    expect(browserCustomBangs()).toEqual([wiki]);
  });

  it("drops malformed bangs a Space hands back", async () => {
    invoke.mockResolvedValue({
      spaceId: null,
      engine: "google",
      engines: [],
      bangs: [jira, { trigger: "Bad One", name: "x", url: "nope" }],
    });
    await refreshSpaceSearch();
    expect(browserCustomBangs()).toEqual([jira]);
  });
});
