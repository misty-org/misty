import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Where older builds kept the setup state, in the webview's storage; it moves into `misty.db`. */
export const setupStorageKey = "misty-first-run-setup";
/** Accounts that finished or skipped the old walkthrough have already been through onboarding. */
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
  /** The first setup was finished on this device. Until then a sign-in leads to it, and signed out
   * the window opens on the welcome; after it, on sign in. */
  welcomed: boolean;
  /** The wizard finished; the tab side is asked once the browser is on screen. */
  tabSidePending: boolean;
}

interface SetupState extends SetupChoices {
  finishWelcome: () => void;
  askTabSide: () => void;
  settleTabSide: () => void;
}

/** Reads what is stored, including the old webview copy, which wrapped it as `{ state, version }`. */
function normalize(stored: unknown): SetupChoices {
  const outer = (stored ?? {}) as { state?: unknown };
  const inner = (outer.state && typeof outer.state === "object" ? outer.state : outer) as {
    welcomed?: unknown;
    tabSidePending?: unknown;
    completedAccounts?: Record<string, boolean>;
  };
  // A device that went through the old setup dialog or walkthrough has seen the welcome.
  const setUpBefore = Object.keys(inner.completedAccounts ?? {}).length > 0 || legacyTourDone();
  return {
    welcomed: typeof inner.welcomed === "boolean" ? inner.welcomed : setUpBefore,
    tabSidePending: inner.tabSidePending === true,
  };
}

/**
 * Kept for this device in `misty.db`. `welcomed` decides the first route before anyone signs in,
 * so the copy cached in the webview paints it at once and a returning person never sees the
 * welcome flash up while the database answers.
 */
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
