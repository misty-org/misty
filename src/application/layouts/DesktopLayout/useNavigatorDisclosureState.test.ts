import { useSettingsStore } from "@/features/settings";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  navigatorDisclosureSetting,
  useNavigatorDisclosureState,
} from "./useNavigatorDisclosureState";

const updateSetting = useSettingsStore.getState().updateSetting;

afterEach(() => {
  useSettingsStore.setState({
    loaded: false,
    settings: null,
    updateSetting,
  });
});

describe("navigatorDisclosureSetting", () => {
  it("reads account-scoped disclosure state from the native settings document", () => {
    const document = {
      navigation: {
        disclosures_by_account: {
          "account-1": { apps: true, inbox: false, files: true },
          "account-2": { apps: false },
        },
      },
    };

    expect(navigatorDisclosureSetting(document, "account-1", "apps")).toBe(true);
    expect(navigatorDisclosureSetting(document, "account-1", "inbox")).toBe(false);
    expect(navigatorDisclosureSetting(document, "account-2", "apps")).toBe(false);
    expect(navigatorDisclosureSetting(document, "account-2", "files")).toBeUndefined();
  });

  it("uses the guest account and ignores malformed saved values", () => {
    expect(
      navigatorDisclosureSetting(
        {
          navigation: {
            disclosures_by_account: {
              guest: { files: true, agents: "open" },
            },
          },
        },
        "",
        "files",
      ),
    ).toBe(true);
    expect(
      navigatorDisclosureSetting(
        {
          navigation: {
            disclosures_by_account: {
              guest: { agents: "open" },
            },
          },
        },
        "",
        "agents",
      ),
    ).toBeUndefined();
  });

  it("writes disclosure changes through the native settings document", () => {
    const save = vi.fn();
    useSettingsStore.setState({
      loaded: true,
      settings: {
        path: "/Users/test/.misty/config/settings.json",
        document: {
          navigation: {
            disclosures_by_account: {
              "account-1": { files: true },
            },
          },
        },
      },
      updateSetting: save,
    });

    const { result } = renderHook(() => useNavigatorDisclosureState("account-1", "agents", false));
    act(() => result.current[1](true));

    expect(save).toHaveBeenCalledWith("navigation", "disclosures_by_account", {
      "account-1": { files: true, agents: true },
    });
  });
});
