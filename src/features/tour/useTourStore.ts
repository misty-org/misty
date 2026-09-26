import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TourStep } from "./types";

const guestAccountKey = "guest";
export const tourStorageKey = "misty-app-tour";

function accountKey(accountId?: string | null): string {
  return accountId?.trim() || guestAccountKey;
}

export interface TourState {
  isOpen: boolean;
  currentStep: TourStep;
  completedAccounts: Record<string, boolean>;
  startTour: (step?: TourStep) => void;
  setStep: (step: TourStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: (accountId?: string | null) => void;
  finishTour: (accountId?: string | null) => void;
  resetTour: (accountId?: string | null) => void;
}

export function isTourCompletedForAccount(
  state: Pick<TourState, "completedAccounts">,
  accountId?: string | null,
): boolean {
  return state.completedAccounts[accountKey(accountId)] ?? false;
}

export const STEP_SEQUENCE: readonly TourStep[] = [
  "welcome",
  "navigation",
  "website-groups",
  "canvas-tabs",
  "virtual-windows",
  "complete",
];

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      currentStep: "closed",
      completedAccounts: {},

      startTour: (step = "welcome") =>
        set({
          isOpen: true,
          currentStep: step,
        }),

      setStep: (step) =>
        set({
          isOpen: step !== "closed",
          currentStep: step,
        }),

      nextStep: () => {
        const { currentStep } = get();
        const currentIndex = STEP_SEQUENCE.indexOf(currentStep);
        if (currentIndex >= 0 && currentIndex < STEP_SEQUENCE.length - 1) {
          set({ currentStep: STEP_SEQUENCE[currentIndex + 1] });
        } else {
          set({ isOpen: false, currentStep: "closed" });
        }
      },

      prevStep: () => {
        const { currentStep } = get();
        const currentIndex = STEP_SEQUENCE.indexOf(currentStep);
        if (currentIndex > 0) {
          set({ currentStep: STEP_SEQUENCE[currentIndex - 1] });
        }
      },

      skipTour: (accountId) =>
        set((state) => ({
          isOpen: false,
          currentStep: "closed",
          completedAccounts: {
            ...state.completedAccounts,
            [accountKey(accountId)]: true,
          },
        })),

      finishTour: (accountId) =>
        set((state) => ({
          isOpen: false,
          currentStep: "closed",
          completedAccounts: {
            ...state.completedAccounts,
            [accountKey(accountId)]: true,
          },
        })),

      resetTour: (accountId) =>
        set((state) => {
          const updated = { ...state.completedAccounts };
          delete updated[accountKey(accountId)];
          return {
            isOpen: true,
            currentStep: "welcome",
            completedAccounts: updated,
          };
        }),
    }),
    {
      name: tourStorageKey,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        completedAccounts: state.completedAccounts,
      }),
    },
  ),
);
