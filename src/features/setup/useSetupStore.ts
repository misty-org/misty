import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SetupStep = "spaces" | "theme" | "import";

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
  return state.completedAccounts[accountKey(accountId)] ?? false;
}

export const useSetupStore = create<SetupState>()(
  persist(
    (set) => ({
      isOpen: false,
      step: "spaces",
      completedAccounts: {},
      startSetup: () => set({ isOpen: true, step: "spaces" }),
      setStep: (step) => set({ step }),
      finishSetup: (accountId) =>
        set((state) => ({
          isOpen: false,
          step: "spaces",
          completedAccounts: { ...state.completedAccounts, [accountKey(accountId)]: true },
        })),
      reopenSetup: () => set({ isOpen: true, step: "spaces" }),
    }),
    {
      name: setupStorageKey,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ completedAccounts: state.completedAccounts }),
      merge: (persisted, current) => {
        const saved = (persisted as Partial<SetupState> | undefined)?.completedAccounts;
        return {
          ...current,
          completedAccounts: { ...legacyCompletedAccounts(), ...(saved ?? {}) },
        };
      },
    },
  ),
);
