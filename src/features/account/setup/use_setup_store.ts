import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export const setupStorageKey = "misty-first-run-setup";
const legacyTourStorageKey = "misty-app-tour";

function legacyTourDone(): boolean {
  try {
    const raw = localStorage.getItem(legacyTourStorageKey);
    const completed = raw ? JSON.parse(raw)?.state?.completedAccounts : null;
    return Boolean(completed && typeof completed === "object" && Object.keys(completed).length);
  } catch {
    return false;
  }
}

interface SetupChoices {
  welcomed: boolean;
  tabSidePending: boolean;
}

interface SetupState extends SetupChoices {
  finishWelcome: () => void;
  askTabSide: () => void;
  settleTabSide: () => void;
}

function normalize(stored: unknown): SetupChoices {
  const outer = (stored ?? {}) as { state?: unknown };
  const inner = (outer.state && typeof outer.state === "object" ? outer.state : outer) as {
    welcomed?: unknown;
    tabSidePending?: unknown;
    completedAccounts?: Record<string, boolean>;
  };
  const setUpBefore = Object.keys(inner.completedAccounts ?? {}).length > 0 || legacyTourDone();
  return {
    welcomed: typeof inner.welcomed === "boolean" ? inner.welcomed : setUpBefore,
    tabSidePending: inner.tabSidePending === true,
  };
}

const savedSetup = createDeviceSetting<SetupChoices>({
  scope: "first-run-setup",
  defaults: { welcomed: legacyTourDone(), tabSidePending: false },
  normalize,
  legacyKey: setupStorageKey,
});

const change = (patch: Partial<SetupChoices>) =>
  savedSetup.getState().set((current) => ({ ...current, ...patch }));

export const useSetupStore = create<SetupState>()(() => ({
  ...savedSetup.getState().value,
  finishWelcome: () => change({ welcomed: true }),
  askTabSide: () => change({ tabSidePending: true }),
  settleTabSide: () => change({ tabSidePending: false }),
}));

savedSetup.subscribe(({ value }, previous) => {
  if (value !== previous.value) useSetupStore.setState(value);
});
