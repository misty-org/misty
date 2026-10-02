import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import { accountApi, AccountApiError } from "@/api/account/api";

/** The password prompt guarding Hidden and Recently Deleted. */
export function useLibraryUnlock(data: SpaceLibraryData) {
  const { spaceId, unlockScope, setUnlockScope, unlockPassword, setUnlockPassword } = data;
  const { unlockSaving, setUnlockSaving, setSensitiveGrants, setLocalError } = data;
  const { unlockConfigured, setUnlockConfigured, unlockConfirmation, setUnlockConfirmation } = data;

  const requestSensitiveUnlock = (scope: "hidden" | "recently_deleted") => {
    setUnlockPassword("");
    setUnlockConfirmation("");
    setUnlockConfigured(null);
    setLocalError("");
    setUnlockScope(scope);
  };

  const submitSensitiveUnlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!unlockScope || !unlockPassword || unlockSaving || unlockConfigured === null) return;
    if (!unlockConfigured && unlockPassword !== unlockConfirmation) {
      setLocalError("Library passwords do not match.");
      return;
    }
    setUnlockSaving(true);
    setLocalError("");
    try {
      if (!unlockConfigured) {
        await accountApi.setLibraryPassword(unlockPassword, unlockConfirmation);
        setUnlockConfigured(true);
        setUnlockConfirmation("");
      }
      const grant = await spacesApi.reauthenticateLibrary(spaceId, unlockScope, unlockPassword);
      setSensitiveGrants((current) => ({
        ...current,
        [unlockScope]: { token: grant.token, expiresAt: grant.expires_at },
      }));
      setUnlockScope("");
      setUnlockPassword("");
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 409) {
        setUnlockConfigured(true);
        setUnlockPassword("");
        setUnlockConfirmation("");
      }
      setLocalError(
        error instanceof Error ? error.message : "This collection could not be unlocked.",
      );
    } finally {
      setUnlockSaving(false);
    }
  };

  return { requestSensitiveUnlock, submitSensitiveUnlock };
}
