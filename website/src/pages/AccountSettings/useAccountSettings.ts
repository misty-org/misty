import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAuth } from "@/AuthContext";
import { useUserStore } from "@/store/userStore";
import { isSettingsPathname } from "./settingsRoute";
import {
  fetchBillingUsage,
  fetchMe,
  type BillingUsageResponse,
} from "./api";

export type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Loads everything the settings dialog renders and owns the redirect rules that
 * apply when the visitor is signed out or their session has expired. All of it
 * is scoped to `open` so a closed dialog never fetches.
 */
export function useAccountSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, sessionReady, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { me, loading, setMe, setLoading, patchMe } = useUserStore();
  const [loadError, setLoadError] = useState("");
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [usageState, setUsageState] = useState<LoadState>("idle");
  const [usageError, setUsageError] = useState("");
  const [usageRequest, setUsageRequest] = useState(0);
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingError, setBillingError] = useState("");

  // A signed-out visitor who arrived on a settings URL — the desktop hand-off
  // when the browser has no session — is sent to sign-in and brought back here
  // afterwards, rather than dumped on the home page.
  const returnTo = isSettingsPathname(location.pathname)
    ? location.pathname
    : undefined;

  useEffect(() => {
    if (!open || !sessionReady) return;
    if (user) return;

    void Promise.resolve().then(() => {
      onOpenChange(false);
      navigate("/signin", { state: returnTo ? { from: returnTo } : undefined });
    });
  }, [open, user, sessionReady, navigate, onOpenChange, returnTo]);

  useEffect(() => {
    if (!open || !user || me) return;

    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadError("");
      setLoading(true);
      try {
        const account = await fetchMe();
        if (active) setMe(account);
      } catch (error) {
        if (!active) return;
        const requestError = error as Error & { status?: number };
        if (requestError.status === 401) {
          onOpenChange(false);
          // logout() ends in a hard navigation, so the destination goes through
          // it. A navigate() here would be overwritten.
          logout("/signin");
          return;
        }
        setLoadError(
          requestError.message || "Could not load your Misty account.",
        );
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [open, user, me, logout, navigate, onOpenChange, setLoading, setMe]);

  useEffect(() => {
    if (!open || !user) return;

    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setUsageState("loading");
      setUsageError("");
      try {
        const nextUsage = await fetchBillingUsage();
        if (!active) return;
        setUsage(nextUsage);
        setUsageState("ready");
      } catch (error) {
        if (!active) return;
        setUsageError(
          error instanceof Error ? error.message : "Could not load usage.",
        );
        setUsageState("error");
      }
    });

    return () => {
      active = false;
    };
  }, [open, user, usageRequest]);

  /** Sends the visitor to Stripe checkout or the customer portal. */
  function openBillingAction(action: () => Promise<{ url: string }>) {
    setBillingWorking(true);
    setBillingError("");
    void action()
      .then(({ url }) => {
        setBillingWorking(false);
        window.location.assign(url);
      })
      .catch((error) => {
        setBillingError(
          error instanceof Error ? error.message : "Could not start billing.",
        );
        setBillingWorking(false);
      });
  }

  /** Keeps the cached account and the auth session in sync after a rename. */
  function renameAccount(name: string) {
    patchMe({ name });
    if (user) setUser({ ...user, name });
  }

  /**
   * Bumps the cached version so the avatar `<img>` URL changes and the browser
   * refetches instead of serving the old picture from cache.
   */
  function bumpAvatarVersion() {
    patchMe({ avatar_version: (me?.avatar_version ?? 0) + 1 });
  }

  /** A scheduled deletion invalidates the session, so end it here. */
  function finishDeletion() {
    logout("/");
  }

  return {
    me,
    loading,
    loadError,
    usage,
    usageState,
    usageError,
    billingWorking,
    billingError,
    openBillingAction,
    renameAccount,
    bumpAvatarVersion,
    finishDeletion,
    retryUsage: () => setUsageRequest((request) => request + 1),
  };
}
