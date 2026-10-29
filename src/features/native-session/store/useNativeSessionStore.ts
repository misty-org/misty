import { isAccountSessionTransitioning, readAccountSessionGeneration } from "@/features/auth";
import type { CurrentUser, NativeSession } from "../model/types";
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
      const session = await invoke<NativeSession>("check_system");
      if (!isCurrentSessionRequest(request)) return;
      set({ status: session, systemError: "" });
    } catch (error) {
      if (!isCurrentSessionRequest(request)) return;
      set({ systemError: String(error) });
    }
  },
  refreshSession: async () => {
    if (isAccountSessionTransitioning() || !hasTauriInternals()) return;
    const request = beginSessionRequest();
    try {
      const session = await invoke<NativeSession>("check_system");
      if (!isCurrentSessionRequest(request)) return;
      set({ status: session, systemError: "" });
    } catch {
      /* the next refresh retries */
    }
  },
  saveAuthenticatedUser: async (user) => {
    if (!hasTauriInternals()) {
      set({ systemError: "Saving account state is only available in the Misty app." });
      return;
    }
    const session = await invoke<NativeSession>("save_authenticated_user", { user });
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
  refreshSession: () => Promise<void>;
  saveAuthenticatedUser: (user: CurrentUser) => Promise<void>;
  signOut: () => Promise<void>;
};
