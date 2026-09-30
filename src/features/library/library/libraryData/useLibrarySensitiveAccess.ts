import type { LibraryUnlockScope } from "@/api/spaces/dto/types/SpaceLibraryDialogs";
import { useEffect, useState } from "react";
import { accountApi } from "@/api/account/api";
import { activeSensitiveGrant } from "../SpaceLibraryPrimitives";
import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

export type SensitiveScope = "" | "hidden" | "recently_deleted";
type SensitiveGrant = { token: string; expiresAt: string };
type SensitiveGrants = Partial<Record<"hidden" | "recently_deleted", SensitiveGrant>>;

/**
 * Password-gated access to Hidden and Recently Deleted.
 *
 * A grant is short-lived, so a timer drops it the moment it expires rather than
 * waiting for the next request to fail. Switching Space clears everything.
 */
export function useLibrarySensitiveAccess(options: {
  spaceId: string;
  collection: LibraryCollectionKind;
  setLocalError: (message: string) => void;
}) {
  const { spaceId, collection, setLocalError } = options;
  const [sensitiveGrants, setSensitiveGrants] = useState<SensitiveGrants>({});
  const [unlockScope, setUnlockScope] = useState<LibraryUnlockScope>("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockSaving, setUnlockSaving] = useState(false);
  const [unlockConfigured, setUnlockConfigured] = useState<boolean | null>(null);
  const [unlockConfirmation, setUnlockConfirmation] = useState("");

  useEffect(() => {
    if (!unlockScope) return;
    let active = true;
    setUnlockConfigured(null);
    void accountApi
      .libraryLock()
      .then(({ configured }) => {
        if (active) setUnlockConfigured(configured);
      })
      .catch((error) => {
        if (active)
          setLocalError(
            error instanceof Error ? error.message : "Could not check the library lock.",
          );
      });
    return () => {
      active = false;
    };
  }, [unlockScope, spaceId, setLocalError]);

  useEffect(() => {
    setSensitiveGrants({});
    setUnlockScope("");
    setUnlockPassword("");
    setUnlockConfirmation("");
    setUnlockConfigured(null);
  }, [spaceId]);

  useEffect(() => {
    const expirations = Object.values(sensitiveGrants)
      .map((grant) => (grant?.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN))
      .filter(Number.isFinite);
    if (expirations.length === 0) return;
    const delay = Math.max(0, Math.min(...expirations) - Date.now());
    const timer = window.setTimeout(
      () =>
        setSensitiveGrants(
          (current) =>
            Object.fromEntries(
              Object.entries(current).filter(([, grant]) => activeSensitiveGrant(grant) !== ""),
            ) as typeof current,
        ),
      delay + 25,
    );
    return () => window.clearTimeout(timer);
  }, [sensitiveGrants]);

  const sensitiveCollectionScope: SensitiveScope =
    collection === "hidden" ? "hidden" : collection === "deleted" ? "recently_deleted" : "";

  return {
    sensitiveGrants,
    setSensitiveGrants,
    unlockScope,
    setUnlockScope,
    unlockPassword,
    setUnlockPassword,
    unlockSaving,
    setUnlockSaving,
    unlockConfigured,
    setUnlockConfigured,
    unlockConfirmation,
    setUnlockConfirmation,
    sensitiveCollectionScope,
    sensitiveCollectionToken: sensitiveCollectionScope
      ? activeSensitiveGrant(sensitiveGrants[sensitiveCollectionScope])
      : "",
    closeSensitiveUnlock: () => {
      if (unlockSaving) return;
      setUnlockScope("");
      setUnlockPassword("");
      setUnlockConfirmation("");
      setUnlockConfigured(null);
      setLocalError("");
    },
  };
}
