import { spacesApi } from "@/services/spaces/api";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

/** The password prompt guarding Hidden and Recently Deleted. */
export function useLibraryUnlock(data: SpaceLibraryData) {
  const { spaceId, unlockScope, setUnlockScope, unlockPassword, setUnlockPassword } = data;
  const { unlockSaving, setUnlockSaving, setSensitiveGrants, setLocalError } = data;

  const requestSensitiveUnlock = (scope: "hidden" | "recently_deleted") => {
    setUnlockPassword("");
    setUnlockScope(scope);
  };

  const submitSensitiveUnlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!unlockScope || !unlockPassword || unlockSaving) return;
    setUnlockSaving(true);
    setLocalError("");
    try {
      const grant = await spacesApi.reauthenticateLibrary(spaceId, unlockScope, unlockPassword);
      setSensitiveGrants((current) => ({
        ...current,
        [unlockScope]: { token: grant.token, expiresAt: grant.expires_at },
      }));
      setUnlockScope("");
      setUnlockPassword("");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "This collection could not be unlocked.",
      );
    } finally {
      setUnlockSaving(false);
    }
  };

  return { requestSensitiveUnlock, submitSensitiveUnlock };
}
