import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCustomBangs } from "../addresses/browserSearchEngine";
import { configureDeviceBangs, refreshProfileSearch, useProfileSearchStore } from "./profileSearch";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const jira = { trigger: "jira", name: "Jira", url: "https://jira.example/search?q=%s" };
const wiki = { trigger: "wiki", name: "Team wiki", url: "https://wiki.example/?q=%s" };

afterEach(() => {
  invoke.mockReset();
  useProfileSearchStore.setState({ profile: null, deviceBangsRaw: "[]" });
});

describe("search settings as profile data", () => {
  it("uses the window's profile's bangs instead of this computer's own", async () => {
    invoke.mockResolvedValue({ profile: "work", engine: "google", engines: [], bangs: [jira] });
    configureDeviceBangs(JSON.stringify([wiki]));
    await refreshProfileSearch();
    expect(invoke).toHaveBeenCalledWith("browser_profile_search");
    expect(browserCustomBangs()).toEqual([jira]);
  });

  it("falls back to this computer's own bangs while the profile's can't be read", async () => {
    invoke.mockResolvedValue(null);
    configureDeviceBangs(JSON.stringify([wiki]));
    await refreshProfileSearch();
    expect(useProfileSearchStore.getState().profile).toBeNull();
    expect(browserCustomBangs()).toEqual([wiki]);
  });

  it("drops malformed bangs a profile hands back", async () => {
    invoke.mockResolvedValue({
      profile: "personal",
      engine: "google",
      engines: [],
      bangs: [jira, { trigger: "Bad One", name: "x", url: "nope" }],
    });
    await refreshProfileSearch();
    expect(browserCustomBangs()).toEqual([jira]);
  });
});
