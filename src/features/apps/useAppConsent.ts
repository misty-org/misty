import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OfficialApp } from "@/api/apps";

// Personal consent is separate from a Space manager granting app access.
// Bind it to the declared permissions, so broader access requires a new review.
export const appConsentKey = (accountId: string, app: OfficialApp) =>
  JSON.stringify([
    accountId,
    app.id,
    app.publisher,
    app.repository_url,
    app.permission_version,
    [...(app.scopes ?? [])].sort(),
    [...(app.network_origins ?? [])].sort(),
  ]);

export const useAppConsent = create<{
  agreed: Record<string, boolean>;
  agree: (accountId: string, app: OfficialApp) => void;
}>()(
  persist(
    (set) => ({
      agreed: {},
      agree: (accountId, app) => {
        if (!accountId) throw new Error("Sign in before agreeing to app permissions.");
        set((state) => ({ agreed: { ...state.agreed, [appConsentKey(accountId, app)]: true } }));
      },
    }),
    { name: "misty-app-personal-consent", partialize: (state) => ({ agreed: state.agreed }) },
  ),
);
