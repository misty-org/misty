import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SetupStep = "import" | "tabs";

const guestAccountKey = "guest";
export const setupStorageKey = "misty-first-run-setup";
/** Accounts that finished or skipped the old walkthrough have already been through onboarding. */
const legacyTourStorageKey = "misty-app-tour";

function accountKey(accountId?: string | null): string {
  return accountId?.trim() || guestAccountKey;
}

function legacyCompletedAccounts(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(legacyTourStorageKey);
    const completed = raw ? JSON.parse(raw)?.state?.completedAccounts : null;
    return completed && typeof completed === "object" ? completed : {};
  } catch {
    return {};
  }
}

export interface SetupState {
  isOpen: boolean;
  step: SetupStep;
  completedAccounts: Record<string, boolean>;
  /** The first-run welcome was passed on this device, by Start browsing or signing in.
   * After that Misty opens straight into the browser, signed in or not. */
  welcomed: boolean;
  finishWelcome: () => void;
  startSetup: () => void;
  setStep: (step: SetupStep) => void;
  finishSetup: (accountId?: string | null) => void;
  /** Runs setup again from the start, e.g. from Help. */
  reopenSetup: () => void;
}

export function isSetupCompletedForAccount(
  state: Pick<SetupState, "completedAccounts">,
  accountId?: string | null,
): boolean {
  // Setup is about this device (import, where tabs sit), so setup done while browsing
  // without an account carries over to whoever signs in.
  return (
    (state.completedAccounts[accountKey(accountId)] ?? false) ||
    (state.completedAccounts[guestAccountKey] ?? false)
  );
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      isOpen: false,
      step: "import",
      completedAccounts: {},
      welcomed: false,
      finishWelcome: () => set({ welcomed: true }),
      startSetup: () => set({ isOpen: true, step: "import" }),
      setStep: (step) => set({ step }),
      finishSetup: (accountId) =>
        set((state) => ({
          isOpen: false,
          step: "import",
          completedAccounts: { ...state.completedAccounts, [accountKey(accountId)]: true },
        })),
      reopenSetup: () => set({ isOpen: true, step: "import" }),
    }),
    {
      name: setupStorageKey,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        completedAccounts: state.completedAccounts,
        welcomed: state.welcomed,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<SetupState> | undefined;
        const completedAccounts = {
          ...legacyCompletedAccounts(),
          ...(stored?.completedAccounts ?? {}),
        };
        return {
          ...current,
          completedAccounts,
          // A device that already went through setup has seen the welcome.
          welcomed: stored?.welcomed ?? Object.keys(completedAccounts).length > 0,
        };
      },
    },
  ),
);
