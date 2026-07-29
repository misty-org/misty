import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/AuthContext";
import { useUserStore } from "@/store/userStore";
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
  const { me, loading, setMe, setLoading, patchMe } = useUserStore();
  const [loadError, setLoadError] = useState("");
  const [usage, setUsage] = useState<BillingUsageResponse | null>(null);
  const [usageState, setUsageState] = useState<LoadState>("idle");
  const [usageError, setUsageError] = useState("");
  const [usageRequest, setUsageRequest] = useState(0);
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingError, setBillingError] = useState("");

  useEffect(() => {
    if (!open || !sessionReady) return;
    if (user) return;

    void Promise.resolve().then(() => {
      onOpenChange(false);
      navigate("/signin");
    });
  }, [open, user, sessionReady, navigate, onOpenChange]);

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
          logout();
          navigate("/signin", { replace: true });
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
    retryUsage: () => setUsageRequest((request) => request + 1),
  };
}
