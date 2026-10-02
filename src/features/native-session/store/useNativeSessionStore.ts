import type { AccountMeResponse } from "@/features/auth";
import {
  accountFetchMe,
  isAccountSessionTransitioning,
  readAccountSessionGeneration,
} from "@/features/auth";
import type { CurrentLicense, CurrentUser, NativeSession } from "../model/types/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

let sessionRequestSequence = 0;

function beginSessionRequest() {
  return {
    sequence: ++sessionRequestSequence,
    accountGeneration: readAccountSessionGeneration(),
  };
}

function isCurrentSessionRequest(request: { sequence: number; accountGeneration: number }) {
  return (
    request.sequence === sessionRequestSequence &&
    request.accountGeneration === readAccountSessionGeneration()
  );
}

function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

async function refreshVerifiedLicenseIfDue(session: NativeSession): Promise<NativeSession> {
  if (!session.current_user || !session.current_license?.needs_refresh) return session;
  try {
    const me = await accountFetchMe();
    if (me.id !== session.current_user.id) return session;
    return await invoke<NativeSession>("save_verified_license", { license: licenseFromMe(me) });
  } catch {
    return session;
  }
}

export const useNativeSessionStore = create<NativeSessionStore>((set) => ({
  status: null,
  systemError: "",
  loadSystem: async () => {
    if (isAccountSessionTransitioning()) return;
    const request = beginSessionRequest();
    try {
      if (!hasTauriInternals()) {
        if (!isCurrentSessionRequest(request)) return;
        set({ status: null, systemError: "Misty requires the native app runtime." });
        return;
      }
      let session = await invoke<NativeSession>("check_system");
      if (session.current_user) {
        session = await invoke<NativeSession>("ensure_local_access_token");
        session = await refreshVerifiedLicenseIfDue(session);
      }
      if (!isCurrentSessionRequest(request)) return;
      set({ status: session, systemError: "" });
    } catch (error) {
      if (!isCurrentSessionRequest(request)) return;
      set({ systemError: String(error) });
    }
  },
  refreshLocalAccessToken: async () => {
    if (isAccountSessionTransitioning() || !hasTauriInternals()) return;
    const request = beginSessionRequest();
    try {
      const session = await invoke<NativeSession>("ensure_local_access_token");
      const refreshed = session.current_user ? await refreshVerifiedLicenseIfDue(session) : session;
      if (!isCurrentSessionRequest(request)) return;
      set({ status: refreshed, systemError: "" });
    } catch {
      /* the next refresh retries */
    }
  },
  saveAuthenticatedUser: async (user, license) => {
    if (!hasTauriInternals()) {
      set({ systemError: "Saving account state is only available in the Misty app." });
      return;
    }
    const session = await invoke<NativeSession>("save_authenticated_user", {
      user,
      license: license ?? null,
    });
    // Supersede any refresh that started while the native identity was committing.
    beginSessionRequest();
    set({ status: session, systemError: "" });
  },
  signOut: async () => {
    const request = beginSessionRequest();
    if (!hasTauriInternals()) {
      const error = new Error("Signing out is only available in the Misty app.");
      if (isCurrentSessionRequest(request)) set({ systemError: error.message });
      throw error;
    }
    let session: NativeSession;
    try {
      session = await invoke<NativeSession>("sign_out_misty");
    } catch (error) {
      if (isCurrentSessionRequest(request)) set({ systemError: String(error) });
      throw error;
    }
    beginSessionRequest();
    set({ status: session, systemError: "" });
  },
}));

export type NativeSessionStore = {
  status: NativeSession | null;
  systemError: string;
  loadSystem: () => Promise<void>;
  refreshLocalAccessToken: () => Promise<void>;
  saveAuthenticatedUser: (user: CurrentUser, license?: CurrentLicense | null) => Promise<void>;
  signOut: () => Promise<void>;
};
