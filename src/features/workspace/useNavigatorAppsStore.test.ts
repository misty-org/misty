import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NAVIGATOR_APP_IDS, NAVIGATOR_APP_IDS } from "./navigatorApps";
import {
  navigatorAppIdsForAccount,
  navigatorAppsCollapsedForAccount,
  navigatorAppsStorageKey,
  useNavigatorAppsStore,
} from "./useNavigatorAppsStore";

describe("useNavigatorAppsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useNavigatorAppsStore.setState({ appIdsByAccount: {}, collapsedByAccount: {} });
  });

  it("starts every account with lean, universal defaults", () => {
    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toEqual(
      DEFAULT_NAVIGATOR_APP_IDS,
    );
  });

  it("adds and removes apps in the stable catalog order", () => {
    const store = useNavigatorAppsStore.getState();
    store.setAppVisible("account-1", "browser", true);
    store.setAppVisible("account-1", "inbox", false);

    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toEqual([
      "social",
      "journal",
      "files",
      "agents",
      "browser",
    ]);
    expect(NAVIGATOR_APP_IDS).toContain("browser");
    expect(NAVIGATOR_APP_IDS).not.toContain("home");
  });

  it("filters Home out of an older saved app selection", () => {
    const legacyState = {
      appIdsByAccount: { "account-1": ["home", "inbox", "files"] },
    } as unknown as Pick<ReturnType<typeof useNavigatorAppsStore.getState>, "appIdsByAccount">;

    expect(navigatorAppIdsForAccount(legacyState, "account-1")).toEqual(["inbox", "files"]);
  });

  it("preserves an intentionally empty sidebar and keeps accounts separate", () => {
    for (const appId of DEFAULT_NAVIGATOR_APP_IDS) {
      useNavigatorAppsStore.getState().setAppVisible("account-1", appId, false);
    }

    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toEqual([]);
    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-2")).toEqual(
      DEFAULT_NAVIGATOR_APP_IDS,
    );
  });

  it("persists the collapsed preference per account", () => {
    useNavigatorAppsStore.getState().setCollapsed("account-1", true);

    expect(navigatorAppsCollapsedForAccount(useNavigatorAppsStore.getState(), "account-1")).toBe(
      true,
    );
    expect(navigatorAppsCollapsedForAccount(useNavigatorAppsStore.getState(), "account-2")).toBe(
      false,
    );
  });

  it("restores Browser from local storage after a refresh", async () => {
    useNavigatorAppsStore.getState().setAppVisible("account-1", "browser", true);
    const saved = localStorage.getItem(navigatorAppsStorageKey);

    expect(saved).not.toBeNull();
    expect(saved).toContain("browser");

    useNavigatorAppsStore.setState({ appIdsByAccount: {}, collapsedByAccount: {} });
    localStorage.setItem(navigatorAppsStorageKey, saved ?? "");
    await useNavigatorAppsStore.persist.rehydrate();

    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toContain(
      "browser",
    );
    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toContain(
      "agents",
    );
  });

  it("migrates an older saved selection instead of falling back to defaults", async () => {
    useNavigatorAppsStore.setState({ appIdsByAccount: {}, collapsedByAccount: {} });
    localStorage.setItem(
      navigatorAppsStorageKey,
      JSON.stringify({
        state: {
          appIdsByAccount: {
            "account-1": ["inbox", "social", "journal", "files", "browser"],
          },
          collapsedByAccount: {},
        },
        version: 0,
      }),
    );

    await useNavigatorAppsStore.persist.rehydrate();

    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toContain(
      "browser",
    );
  });

  it("adopts apps chosen before the signed-in account finishes loading", () => {
    useNavigatorAppsStore.getState().setAppVisible("", "browser", true);
    useNavigatorAppsStore.getState().adoptGuestApps("account-1");

    expect(navigatorAppIdsForAccount(useNavigatorAppsStore.getState(), "account-1")).toContain(
      "browser",
    );
    expect(useNavigatorAppsStore.getState().appIdsByAccount.guest).toBeUndefined();
  });
});
