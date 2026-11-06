import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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

interface SetupState {
  /** The first-run welcome was passed on this device, by finishing or leaving its wizard, or by
   * signing in. After that Misty opens straight into the browser, signed in or not. */
  welcomed: boolean;
  finishWelcome: () => void;
  /** The wizard finished; the tab side is asked once the browser is on screen. */
  tabSidePending: boolean;
  askTabSide: () => void;
  settleTabSide: () => void;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      welcomed: false,
      finishWelcome: () => set({ welcomed: true }),
      tabSidePending: false,
      askTabSide: () => set({ tabSidePending: true }),
      settleTabSide: () => set({ tabSidePending: false }),
    }),
    {
      name: setupStorageKey,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        welcomed: state.welcomed,
        tabSidePending: state.tabSidePending,
      }),
      merge: (persisted, current) => {
        const stored = persisted as
          | {
              welcomed?: boolean;
              tabSidePending?: boolean;
              completedAccounts?: Record<string, boolean>;
            }
          | undefined;
        // A device that went through the old setup dialog or walkthrough has seen the welcome.
        const setUpBefore =
          Object.keys(stored?.completedAccounts ?? {}).length > 0 || legacyTourDone();
        return {
          ...current,
          welcomed: stored?.welcomed ?? setUpBefore,
          tabSidePending: stored?.tabSidePending ?? false,
        };
      },
    },
  ),
);
